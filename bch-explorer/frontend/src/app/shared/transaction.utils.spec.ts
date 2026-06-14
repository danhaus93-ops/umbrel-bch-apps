import { decodeRawTransaction } from '@app/shared/transaction.utils';

/**
 * Raw BCH mainnet transaction (version 2, 1 input, 2 outputs, no segwit).
 *
 * Input:
 *   txid: cba8e08160edfd4dc9e1070d00af3e10ef9f8f060cc2553942a210f6a64784bd, vout: 0
 *   address (derived from scriptSig pubkey): bitcoincash:qr9azvqmgjyqyqpf35gej6zcp36j3tf6vcdhjxdng7
 *
 * Outputs:
 *   [0] 291463000 sats  → bitcoincash:qz2xe9g39ck0engqvrsmjcumwwhsxfq88qylncgnlv
 *   [1] 382535364 sats  → bitcoincash:qr9azvqmgjyqyqpf35gej6zcp36j3tf6vcdhjxdng7
 */
const RAW_TX_HEX =
  '0200000001bd8447a6f610a2423955c20c068f9fef103eaf000d07e1c94dfded6081e0a8cb' +
  '000000006a47304402203aeb4f3f44986f34d67a65d28e0272968960e407c9f70398ac83eeb6' +
  '023e69bc022005dd92dc435455f0a9b0bf6312321bdcc9fb1b608dd7739c05201533a9dc93f3' +
  '412103b15b34954f80534387243693eda1ca424e5d7e3c979b0862343a9c03dc5f0c0b' +
  'ffffffff' +
  '02' +
  '585f5f1100000000' +
  '1976a914946c95112e2cfccd0060e1b9639b73af0324073888ac' +
  'c406cd1600000000' +
  '1976a914cbd1301b44880200298d119968580c7528ad3a6688ac' +
  '00000000';

const RAW_TX2_HEX =
  '010000000117d1526cf428aa5be81351900d84c4e971dcdbff3f2e5ffb484856533ddfd221' +
  '01000000644139e9577084cf31c1858534212f0ecdc04b907ae7f8bfe8dad52efe843efeb8' +
  'a8e56e09646ac1fc26dd87987e630fbfb03fd61bef5d58eafadd37ec1941842c74412103b5' +
  'fe1d8d4f3e42c3967bc888b3ad287d9c5bb6d7d5037bf9bc5cb68456efdc73ffffffff01' +
  '6a47c40100000000' +
  '1976a914b0b5ecf44fbfae659e713161ef881fcaa4d9664188ac' +
  '00000000';

/**
 * Raw BCH mainnet transaction (version 1, 1 input, 1 output).
 *
 * Input:
 *   txid: 21d2df3d53564848fb5f2e3fffdbdc71e9c4840d905113e85baa28f46c52d117, vout: 1
 *   address (derived from scriptSig pubkey): bitcoincash:qr8yte7p2a8tafqw8teey0atyzxg9zxprc9l5j6zn9
 *
 * Output:
 *   [0] 29640554 sats (0.29640554 BCH) → bitcoincash:qzcttm85f7l6uev7wyckrmugrl92fktxgy0ny0fkht
 *
 * Fee: 546 sats (input value 29641100 − output 29640554)
 * Size: 185 bytes
 */
// prettier-ignore
const RAW_TX3_HEX = '01000000012187635ddffe786d9ea05d2a4de598f8d3a3c836585b24632046738b4c941c7a010000005701ff4c53ff0488b21e03a7725a88800000004da8aa7bef6db0377eb1cc402a7cb637f962b344fc229e9bd4f49ea4d2b53b3c02d78ea4584075aad21c15fb78e1993b99563f39f31c6f9c4869e704953a1ca48a00000000feffffff0d9af3010000000002e06bc200000000001976a914a8321fe7938e97ef799082fcc87156b540a4eec088ac002d3101000000001976a9147ee7b62fa98a985c5553ff66120a91b8189f658188ac3a760e00';

/**
 * Raw BCH mainnet unsigned transaction (version 1, 1 input, 2 outputs).
 * Uses the BCH unsigned tx format (input value embedded in scriptsig via OP_RETURN push).
 * Decoded via fromBufferWithInputValues fallback path.
 *
 * Input:
 *   txid: 7a1c944c8b73462063245b5836c8a3d3f898e54d2a5da09e6d78fedf5d638721, vout: 1
 *   sequence: 0xfffffffe (RBF / locktime-relative)
 *   spending address: bitcoincash:qpgtf66s2ugu2uc24r8stluuk3734vqykgem4uxv34 (known externally)
 *   input address: not derivable by decodeRawTransaction (unsigned — scriptsig has no pubkey push)
 *
 * Outputs:
 *   [0] 12741600 sats (0.127416 BCH)  → bitcoincash:qz5ry8l8jw8f0mmejzp0ejr32665pf8wcql73560as
 *   [1] 20000000 sats (0.20000000 BCH) → bitcoincash:qplw0d304x9fshz420lkvys2jxup38m9symky6k028
 *
 * Locktime: 947770
 * Size: 214 bytes
 */
describe('decodeRawTransaction — BCH P2PKH unsigned tx (1 in, 2 out)', () => {
  let result: ReturnType<typeof decodeRawTransaction>;

  beforeEach(() => {
    result = decodeRawTransaction(RAW_TX3_HEX, 'mainnet');
  });

  it('should decode without errors', () => {
    expect(result.tx).toBeDefined();
  });

  it('should have version 1', () => {
    expect(result.tx.version).toBe(1);
  });

  it('should have locktime 947770', () => {
    expect(result.tx.locktime).toBe(947770);
  });

  it('should have size 214 bytes', () => {
    expect(RAW_TX3_HEX.length / 2).toBe(214);
  });

  describe('inputs', () => {
    it('should have exactly 1 input', () => {
      expect(result.tx.vin.length).toBe(1);
    });

    it('should have correct txid', () => {
      expect(result.tx.vin[0].txid).toBe(
        '7a1c944c8b73462063245b5836c8a3d3f898e54d2a5da09e6d78fedf5d638721'
      );
    });

    it('should reference vout 1', () => {
      expect(result.tx.vin[0].vout).toBe(1);
    });

    it('should not be coinbase', () => {
      expect(result.tx.vin[0].is_coinbase).toBe(false);
    });

    it('should have sequence 0xfffffffe', () => {
      expect(result.tx.vin[0].sequence).toBe(0xfffffffe);
    });

    it('should have no derivable input address (unsigned — scriptsig has no pubkey push)', () => {
      // The spending address bitcoincash:qpgtf66s2ugu2uc24r8stluuk3734vqykgem4uxv34
      // is displayed in the UI because transaction-raw.component.ts calls fetchPrevouts()
      // which hits /api/v1/prevouts to retrieve the real UTXO data from the chain.
      // decodeRawTransaction alone cannot derive it from the unsigned scriptsig.
      expect(result.tx.vin[0].prevout?.scriptpubkey_address).toBeUndefined();
    });
  });

  describe('outputs', () => {
    it('should have exactly 2 outputs', () => {
      expect(result.tx.vout.length).toBe(2);
    });

    it('output[0] should have value 12741600 sats (0.127416 BCH)', () => {
      expect(result.tx.vout[0].value).toBe(12741600);
    });

    it('output[0] should go to bitcoincash:qz5ry8l8jw8f0mmejzp0ejr32665pf8wcql73560as', () => {
      expect(result.tx.vout[0].scriptpubkey_address).toBe(
        'bitcoincash:qz5ry8l8jw8f0mmejzp0ejr32665pf8wcql73560as'
      );
    });

    it('output[1] should have value 20000000 sats (0.20000000 BCH)', () => {
      expect(result.tx.vout[1].value).toBe(20000000);
    });

    it('output[1] should go to bitcoincash:qplw0d304x9fshz420lkvys2jxup38m9symky6k028', () => {
      expect(result.tx.vout[1].scriptpubkey_address).toBe(
        'bitcoincash:qplw0d304x9fshz420lkvys2jxup38m9symky6k028'
      );
    });
  });
});

describe('decodeRawTransaction — BCH P2PKH tx (1 in, 1 out)', () => {
  let result: ReturnType<typeof decodeRawTransaction>;

  beforeEach(() => {
    result = decodeRawTransaction(RAW_TX2_HEX, 'mainnet');
  });

  it('should decode without warnings', () => {
    expect(result.warnings).toEqual([]);
  });

  it('should round-trip the hex', () => {
    expect(result.hex).toBe(RAW_TX2_HEX);
  });

  it('should have version 1', () => {
    expect(result.tx.version).toBe(1);
  });

  it('should have locktime 0', () => {
    expect(result.tx.locktime).toBe(0);
  });

  it('should have size 185 bytes', () => {
    expect(RAW_TX2_HEX.length / 2).toBe(185);
  });

  describe('inputs', () => {
    it('should have exactly 1 input', () => {
      expect(result.tx.vin.length).toBe(1);
    });

    it('should have correct txid', () => {
      expect(result.tx.vin[0].txid).toBe(
        '21d2df3d53564848fb5f2e3fffdbdc71e9c4840d905113e85baa28f46c52d117'
      );
    });

    it('should reference vout 1', () => {
      expect(result.tx.vin[0].vout).toBe(1);
    });

    it('should not be coinbase', () => {
      expect(result.tx.vin[0].is_coinbase).toBe(false);
    });

    it('should have sequence 0xffffffff', () => {
      expect(result.tx.vin[0].sequence).toBe(0xffffffff);
    });

    it('should derive sender address from scriptSig pubkey', () => {
      expect(result.tx.vin[0].prevout?.scriptpubkey_address).toBe(
        'bitcoincash:qr8yte7p2a8tafqw8teey0atyzxg9zxprc9l5j6zn9'
      );
    });
  });

  describe('outputs', () => {
    it('should have exactly 1 output', () => {
      expect(result.tx.vout.length).toBe(1);
    });

    it('output[0] should have value 29640554 sats (0.29640554 BCH)', () => {
      expect(result.tx.vout[0].value).toBe(29640554);
    });

    it('output[0] should go to bitcoincash:qzcttm85f7l6uev7wyckrmugrl92fktxgy0ny0fkht', () => {
      expect(result.tx.vout[0].scriptpubkey_address).toBe(
        'bitcoincash:qzcttm85f7l6uev7wyckrmugrl92fktxgy0ny0fkht'
      );
    });
  });
});

describe('decodeRawTransaction — BCH P2PKH tx (1 in, 2 out)', () => {
  let result: ReturnType<typeof decodeRawTransaction>;

  beforeEach(() => {
    result = decodeRawTransaction(RAW_TX_HEX, 'mainnet');
  });

  it('should decode without warnings', () => {
    expect(result.warnings).toEqual([]);
  });

  it('should round-trip the hex', () => {
    expect(result.hex).toBe(RAW_TX_HEX);
  });

  it('should have version 2', () => {
    expect(result.tx.version).toBe(2);
  });

  it('should have locktime 0', () => {
    expect(result.tx.locktime).toBe(0);
  });

  it('should have size 225 bytes', () => {
    expect(RAW_TX_HEX.length / 2).toBe(225);
  });

  describe('inputs', () => {
    it('should have exactly 1 input', () => {
      expect(result.tx.vin.length).toBe(1);
    });

    it('should have correct txid', () => {
      expect(result.tx.vin[0].txid).toBe(
        'cba8e08160edfd4dc9e1070d00af3e10ef9f8f060cc2553942a210f6a64784bd'
      );
    });

    it('should reference vout 0', () => {
      expect(result.tx.vin[0].vout).toBe(0);
    });

    it('should not be coinbase', () => {
      expect(result.tx.vin[0].is_coinbase).toBe(false);
    });

    it('should have sequence 0xffffffff', () => {
      expect(result.tx.vin[0].sequence).toBe(0xffffffff);
    });

    it('should derive sender address from scriptSig pubkey', () => {
      expect(result.tx.vin[0].prevout?.scriptpubkey_address).toBe(
        'bitcoincash:qr9azvqmgjyqyqpf35gej6zcp36j3tf6vcdhjxdng7'
      );
    });
  });

  describe('outputs', () => {
    it('should have exactly 2 outputs', () => {
      expect(result.tx.vout.length).toBe(2);
    });

    it('output[0] should have value 291463000 sats (2.91463 BCH)', () => {
      expect(result.tx.vout[0].value).toBe(291463000);
    });

    it('output[0] should go to qz2xe9g39ck0engqvrsmjcumwwhsxfq88qylncgnlv', () => {
      expect(result.tx.vout[0].scriptpubkey_address).toBe(
        'bitcoincash:qz2xe9g39ck0engqvrsmjcumwwhsxfq88qylncgnlv'
      );
    });

    it('output[1] should have value 382535364 sats (3.82535364 BCH)', () => {
      expect(result.tx.vout[1].value).toBe(382535364);
    });

    it('output[1] should go to qr9azvqmgjyqyqpf35gej6zcp36j3tf6vcdhjxdng7', () => {
      expect(result.tx.vout[1].scriptpubkey_address).toBe(
        'bitcoincash:qr9azvqmgjyqyqpf35gej6zcp36j3tf6vcdhjxdng7'
      );
    });
  });
});

/**
 * Raw BCH mainnet CashToken transaction (version 2, 2 inputs, 2 outputs).
 *
 * Input[0]: d90ce9d43a93e6b270c0ef281a305866ae400e64589d8b9e9762b2bb08013310:0
 *   CashToken prevout (category set on the UTXO being spent; not encoded in the raw tx itself)
 *
 * Input[1]: 737fdd3fafe4bf124c984641a7e33994ded439c460d26382c940b7039f2c3685:1
 *   Standard P2PKH input
 *
 * Output[0]: 1000 sats → P2SH32 locking script with CashToken prefix
 *   token_category: 6c47906ae20adfb3400baf6242802e5c03761f4e90574894d371ca2e8b2c7746
 *   token_nft_capability: mutable
 *   token_nft_commitment: 0030da180002ad0000
 *
 * Output[1]: 135648500 sats → bitcoincash:qzpkzmpx2mwya8u42vyg05vxdxfccnuxmc2wdyth90 (P2PKH)
 */
const RAW_CASHTOKEN_TX_HEX =
  '020000000210330108bbb262979e8b9d58640e40ae6658301a28efc070b2e6933ad4e90cd9' +
  '00000000fd2d0140f8a9b103d4f610f07ce42fddeb5c9f987b543f1810ffd208a8b55c1ff' +
  '0e1693afee7187b53d9de53f3c7fbdf062f884d6aa148469859202c0f45f434a69b17a310' +
  'd9dfe7694ada180030da180002ad0000004cd8203ed5e7bcaa1fe4699d5672a7144a7f5b05' +
  '66ae49839a2b43ff9f3b911410b4d02102d09db08af1ff4e8453919cc866a4be427d7bfe1' +
  '8f2c05e5444c196fcf6fd28185279009c63c0009d00cd00c78800d100ce8800cc02e8039d' +
  '00d3009d547a54797bbb7b587f77547f7881765a97009c00cf517f77547f81547981787c9' +
  '4907c02c80096a27b7c9b6981a06901007b7e7c7e00d2877777675279519c63c0cdc0c788' +
  'c0d1c0ce88c0cc02e8039dc0d3009dc0d2c0cf87777777677b529dc0009d51ce01207f757' +
  'b8800d100ce8800cc02e8039c776868feffffff85362c9f03b740c98263d260c439d4de943' +
  '9e3a74146984c12bfe4af3fdd7f73010000006441aa798d753f1ad83bd4faf9bc77344e15' +
  '4bda7dab2d025419011980d77d7e58477664fef3ac64e2a309d3253857dfb6558fd643117' +
  'c28823a754d12acb60f48656121032ea97c9bb5d7efc09e1155178169173838c377f70a68' +
  '6af1b05f169b47ae65adfeffffff02e8030000000000004fef46772c8b2eca71d3944857' +
  '904e1f76035c2e804262af0b40b3df0ae26a90476c61090030da180002ad0000aa206ed67' +
  '2972210f1bf197bf2a9ae93a25016a6c27176fdf09a57c4ba0843070c7c87f4d415080000' +
  '00001976a91483616c2656dc4e9f95530887d18669938c4f86de88ac00000000';

describe('decodeRawTransaction — BCH CashToken tx (2 in, 2 out)', () => {
  let result: ReturnType<typeof decodeRawTransaction>;

  beforeEach(() => {
    result = decodeRawTransaction(RAW_CASHTOKEN_TX_HEX, 'mainnet');
  });

  it('should decode without errors', () => {
    expect(result.tx).toBeDefined();
  });

  it('should round-trip the hex', () => {
    expect(result.hex).toBe(RAW_CASHTOKEN_TX_HEX);
  });

  it('should have version 2', () => {
    expect(result.tx.version).toBe(2);
  });

  it('should have locktime 0', () => {
    expect(result.tx.locktime).toBe(0);
  });

  describe('inputs', () => {
    it('should have exactly 2 inputs', () => {
      expect(result.tx.vin.length).toBe(2);
    });

    it('vin[0] should have correct txid', () => {
      expect(result.tx.vin[0].txid).toBe(
        'd90ce9d43a93e6b270c0ef281a305866ae400e64589d8b9e9762b2bb08013310'
      );
    });

    it('vin[0] should reference vout 0', () => {
      expect(result.tx.vin[0].vout).toBe(0);
    });

    it('vin[0] should have sequence 0xfffffffe', () => {
      expect(result.tx.vin[0].sequence).toBe(0xfffffffe);
    });

    it('vin[1] should have correct txid', () => {
      expect(result.tx.vin[1].txid).toBe(
        '737fdd3fafe4bf124c984641a7e33994ded439c460d26382c940b7039f2c3685'
      );
    });

    it('vin[1] should reference vout 1', () => {
      expect(result.tx.vin[1].vout).toBe(1);
    });

    it('vin[1] should have sequence 0xfffffffe', () => {
      expect(result.tx.vin[1].sequence).toBe(0xfffffffe);
    });
  });

  describe('outputs', () => {
    it('should have exactly 2 outputs', () => {
      expect(result.tx.vout.length).toBe(2);
    });

    it('vout[0] should have value 1000 sats', () => {
      expect(result.tx.vout[0].value).toBe(1000);
    });

    it('vout[0] should have token_category', () => {
      expect(result.tx.vout[0].token_category).toBe(
        '6c47906ae20adfb3400baf6242802e5c03761f4e90574894d371ca2e8b2c7746'
      );
    });

    it('vout[0] should have token_nft_capability mutable', () => {
      expect(result.tx.vout[0].token_nft_capability).toBe('mutable');
    });

    it('vout[0] should have token_nft_commitment', () => {
      expect(result.tx.vout[0].token_nft_commitment).toBe('0030da180002ad0000');
    });

    it('vout[0] should have no fungible token amount', () => {
      expect(result.tx.vout[0].token_amount).toBeUndefined();
    });

    it('vout[0] should have scriptpubkey_type p2sh32', () => {
      expect(result.tx.vout[0].scriptpubkey_type).toBe('p2sh32');
    });

    it('vout[1] should have value 135648500 sats (1.356485 BCH)', () => {
      expect(result.tx.vout[1].value).toBe(135648500);
    });

    it('vout[1] should have no token_category', () => {
      expect(result.tx.vout[1].token_category).toBeUndefined();
    });

    it('vout[1] should go to bitcoincash:qzpkzmpx2mwya8u42vyg05vxdxfccnuxmc2wdyth90', () => {
      expect(result.tx.vout[1].scriptpubkey_address).toBe(
        'bitcoincash:qzpkzmpx2mwya8u42vyg05vxdxfccnuxmc2wdyth90'
      );
    });
  });
});
