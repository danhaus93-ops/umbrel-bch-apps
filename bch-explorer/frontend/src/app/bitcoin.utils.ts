import { Hash } from '@app/shared/sha256';

/** extracts m and n from a multisig script (asm), returns nothing if it is not a multisig script */
export function parseMultisigScript(
  script: string
): void | { m: number; n: number } {
  if (!script) {
    return;
  }
  const ops = script.split(' ');
  if (ops.length < 3 || ops.pop() !== 'OP_CHECKMULTISIG') {
    return;
  }
  const opN = ops.pop();
  if (opN !== 'OP_0' && !opN.startsWith('OP_PUSHNUM_')) {
    return;
  }
  const n = parseInt(opN.match(/[0-9]+/)[0], 10);
  if (ops.length < n * 2 + 1) {
    return;
  }
  // pop n public keys
  for (let i = 0; i < n; i++) {
    if (!/^0((2|3)\w{64}|4\w{128})$/.test(ops.pop())) {
      return;
    }
    if (!/^OP_PUSHBYTES_(33|65)$/.test(ops.pop())) {
      return;
    }
  }
  const opM = ops.pop();
  if (opM !== 'OP_0' && !opM.startsWith('OP_PUSHNUM_')) {
    return;
  }
  const m = parseInt(opM.match(/[0-9]+/)[0], 10);

  if (ops.length) {
    return;
  }

  return { m, n };
}

// https://github.com/shesek/move-decimal-point
export function moveDec(num: number, n: number) {
  let frac, int, neg, ref;
  if (n === 0) {
    return num.toString();
  }
  ((ref = ('' + num).split('.')), (int = ref[0]), (frac = ref[1]));
  int || (int = '0');
  frac || (frac = '0');
  neg = int[0] === '-' ? '-' : '';
  if (neg) {
    int = int.slice(1);
  }
  if (n > 0) {
    if (n > frac.length) {
      frac += zeros(n - frac.length);
    }
    int += frac.slice(0, n);
    frac = frac.slice(n);
  } else {
    n = n * -1;
    if (n > int.length) {
      int = zeros(n - int.length) + int;
    }
    frac = int.slice(n * -1) + frac;
    int = int.slice(0, n * -1);
  }
  while (int[0] === '0') {
    int = int.slice(1);
  }
  while (frac[frac.length - 1] === '0') {
    frac = frac.slice(0, -1);
  }
  return neg + (int || '0') + (frac.length ? '.' + frac : '');
}

function zeros(n: number) {
  return new Array(n + 1).join('0');
}

// Formats a number for display. Treats the number as a string to avoid rounding errors.
export const formatNumber = (
  s: number | string,
  precision: number | null = null
) => {
  let [whole, dec] = s.toString().split('.');

  // divide numbers into groups of three separated with a thin space (U+202F, "NARROW NO-BREAK SPACE"),
  // but only when there are more than a total of 5 non-decimal digits.
  if (whole.length >= 5) {
    whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  }

  if (precision != null && precision > 0) {
    if (dec == null) {
      dec = '0'.repeat(precision);
    } else if (dec.length < precision) {
      dec += '0'.repeat(precision - dec.length);
    }
  }

  return whole + (dec != null ? '.' + dec : '');
};

// Power of ten wrapper
export function selectPowerOfTen(
  val: number,
  multiplier = 1
): { divider: number; unit: string } {
  const powerOfTen = {
    exa: Math.pow(10, 18),
    peta: Math.pow(10, 15),
    tera: Math.pow(10, 12),
    giga: Math.pow(10, 9),
    mega: Math.pow(10, 6),
    kilo: Math.pow(10, 3),
  };

  let selectedPowerOfTen: { divider: number; unit: string };
  if (val < powerOfTen.kilo * multiplier) {
    selectedPowerOfTen = { divider: 1, unit: '' }; // no scaling
  } else if (val < powerOfTen.mega * multiplier) {
    selectedPowerOfTen = { divider: powerOfTen.kilo, unit: 'k' };
  } else if (val < powerOfTen.giga * multiplier) {
    selectedPowerOfTen = { divider: powerOfTen.mega, unit: 'M' };
  } else if (val < powerOfTen.tera * multiplier) {
    selectedPowerOfTen = { divider: powerOfTen.giga, unit: 'G' };
  } else if (val < powerOfTen.peta * multiplier) {
    selectedPowerOfTen = { divider: powerOfTen.tera, unit: 'T' };
  } else if (val < powerOfTen.exa * multiplier) {
    selectedPowerOfTen = { divider: powerOfTen.peta, unit: 'P' };
  } else {
    selectedPowerOfTen = { divider: powerOfTen.exa, unit: 'E' };
  }

  return selectedPowerOfTen;
}

const featureActivation = {
  mainnet: {
    bla: 32,
    // rbf: 399701,
    // segwit: 477120,
    // taproot: 709632,
  },
  testnet4: {
    bla: 0,
  },
  scalenet: {
    bla: 0,
  },
  chipnet: {
    bla: 0,
  },
};

export function isFeatureActive(
  network: string,
  height: number,
  feature: 'bla' // BCH has no taproot, rbf or segwit, TODO: add BCH features instead
): boolean {
  const activationHeight = featureActivation[network || 'mainnet']?.[feature];
  if (activationHeight != null) {
    return height >= activationHeight;
  } else {
    return false;
  }
}

export async function calcScriptHash$(script: string): Promise<string> {
  if (!/^[0-9a-fA-F]*$/.test(script) || script.length % 2 !== 0) {
    throw new Error('script is not a valid hex string');
  }
  const buf = Uint8Array.from(
    script.match(/.{2}/g).map((byte) => parseInt(byte, 16))
  );
  const hash = new Hash().update(buf).digest();
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map((bytes) => bytes.toString(16).padStart(2, '0')).join('');
}
