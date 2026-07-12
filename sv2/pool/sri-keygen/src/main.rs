use stratum_apps::key_utils::{Secp256k1PublicKey, Secp256k1SecretKey};
use secp256k1::SecretKey;

fn main() {
    let secret = SecretKey::new(&mut rand::thread_rng());
    let sk = Secp256k1SecretKey(secret);
    let pk: Secp256k1PublicKey = Secp256k1PublicKey::from(sk);
    let sk2 = Secp256k1SecretKey(secret);
    println!("PUB={}", pk);
    println!("PRV={}", sk2);
}
