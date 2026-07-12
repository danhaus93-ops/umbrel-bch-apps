// noise-tp-shim: terminates the pool's Noise connection using SRI's own
// network_helpers, and forwards decrypted TDP frames to the Python bridge
// over a plaintext localhost socket. SRI does the crypto; the bridge does BCH.
//
// pool_sv2  --Noise-->  [shim :8442]  --plaintext frames-->  [python bridge :8443]
//
// The shim is deliberately dumb: it never parses TDP semantics. It moves
// already-decrypted SV2 frame bytes both directions. All template logic,
// coinbase reconstruction, and submitblock stay in the verified Python bridge.

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use stratum_apps::network_helpers::accept_noise_connection;
use stratum_apps::utils::types::{Message as Msg, Sv2Frame};
use stratum_core::codec_sv2::StandardEitherFrame;
use stratum_apps::key_utils::{Secp256k1PublicKey, Secp256k1SecretKey};
type EFrame = StandardEitherFrame<Msg>;

const POOL_LISTEN: &str = "0.0.0.0:8442";       // pool connects here (Noise)
// BRIDGE_ADDR from env
const CERT_VALIDITY: u64 = 3600;

// authority keypair MUST match the pool's pool-regtest.toml exactly

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let pub_s = std::env::var("SHIM_AUTH_PUB").expect("SHIM_AUTH_PUB not set");
    let prv_s = std::env::var("SHIM_AUTH_PRV").expect("SHIM_AUTH_PRV not set");
    let pub_key: Secp256k1PublicKey = pub_s.parse().expect("bad pub key");
    let prv_key: Secp256k1SecretKey = prv_s.parse().expect("bad prv key");

    let listener = TcpListener::bind(POOL_LISTEN).await?;
    eprintln!("[shim] Noise TP listening on {POOL_LISTEN}");

    loop {
        let (pool_sock, peer) = listener.accept().await?;
        eprintln!("[shim] pool connected from {peer}");
        let (pk, sk) = (pub_key, prv_key);
        tokio::spawn(async move {
            if let Err(e) = handle(pool_sock, pk, sk).await {
                eprintln!("[shim] session ended: {e:?}");
            }
        });
    }
}

async fn handle(
    pool_sock: TcpStream,
    pub_key: Secp256k1PublicKey,
    prv_key: Secp256k1SecretKey,
) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Noise handshake with the pool, using SRI's tested responder
    let noise = accept_noise_connection::<Msg>(pool_sock, pub_key, prv_key, CERT_VALIDITY)
        .await
        .map_err(|e| format!("noise handshake failed: {e:?}"))?;
    let (mut nrd, mut nwr) = noise.into_split();
    eprintln!("[shim] Noise handshake complete");

    // 2. plaintext frame link to the python bridge
    let bridge_addr = std::env::var("BRIDGE_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8443".to_string());
    let bridge = TcpStream::connect(&bridge_addr).await?;
    let (mut brd, mut bwr) = bridge.into_split();

    // pool -> bridge: decrypt frame, ship raw serialized frame bytes downstream
    let up = tokio::spawn(async move {
        loop {
            let frame: EFrame = match nrd.read_frame().await {
                Ok(f) => f, Err(_) => break,
            };
            // forward raw SV2 frame bytes; the 6-byte header is self-delimiting
            let bytes = frame_to_bytes(frame);
            if bwr.write_all(&bytes).await.is_err() { break; }
        }
    });

    // bridge -> pool: read length-prefixed frame bytes, encrypt via Noise, send
    let down = tokio::spawn(async move {
        loop {
            let mut hdr = [0u8; 6];
            if brd.read_exact(&mut hdr).await.is_err() { break; }
            let plen = (hdr[3] as usize) | ((hdr[4] as usize) << 8) | ((hdr[5] as usize) << 16);
            let mut full = hdr.to_vec();
            full.resize(6 + plen, 0);
            if plen > 0 && brd.read_exact(&mut full[6..]).await.is_err() { break; }
            let frame = bytes_to_frame(full);
            if nwr.write_frame(frame).await.is_err() { break; }
        }
    });

    let _ = tokio::join!(up, down);
    Ok(())
}

// A decrypted StandardEitherFrame serializes to standard SV2 wire bytes
// (6-byte header + payload) — exactly what the Python bridge already speaks.
fn frame_to_bytes(frame: EFrame) -> Vec<u8> {
    match frame {
        StandardEitherFrame::Sv2(f) => {
            let n = f.encoded_length();
            let mut out = vec![0u8; n];
            f.serialize(&mut out).expect("frame serialize");
            out
        }
        StandardEitherFrame::HandShake(_) => Vec::new(),
    }
}

fn bytes_to_frame(bytes: Vec<u8>) -> EFrame {
    let f = Sv2Frame::from_bytes(bytes).expect("bridge sent malformed frame");
    StandardEitherFrame::Sv2(f)
}
