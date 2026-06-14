export const defaultMempoolFeeColors = [
  '19a352',
  '25a04d',
  '309e49',
  '3c9b44',
  '47983f',
  '53953b',
  '5e9336',
  '6a9032',
  '768d2d',
  '818b28',
  '8d8824',
  '98851f',
  'a4821a',
  'af8016',
  'bb7d11',
  'bf7d12',
  'bf7815',
  'bf7319',
  'be6c1e',
  'be6820',
  'bd6125',
  'bd5c28',
  'bc552d',
  'bc4f30',
  'bc4a34',
  'bb4339',
  'bb3d3c',
  'bb373f',
  'ba3243',
  'b92b48',
  'b9254b',
  'b8214d',
  'b71d4f',
  'b61951',
  'b41453',
  'b30e55',
  'b10857',
  'b00259',
  'ae005b',
];

export const contrastMempoolFeeColors = [
  '06adef',
  '0082e6',
  '0984df',
  '1285d9',
  '1a87d2',
  '2388cb',
  '2c8ac5',
  '358bbe',
  '3e8db7',
  '468eb0',
  '4f90aa',
  '5892a3',
  '61939c',
  '6a9596',
  '72968f',
  '7b9888',
  '849982',
  '8d9b7b',
  '959c74',
  '9e9e6e',
  'a79f67',
  'b0a160',
  'b9a35a',
  'c1a453',
  'caa64c',
  'd3a745',
  'dca93f',
  'e5aa38',
  'edac31',
  'f6ad2b',
  'ffaf24',
  'ffb01e',
  'ffb118',
  'ffb212',
  'ffb30c',
  'ffb406',
  'ffb500',
  'ffb600',
  'ffb700',
];

export const lightMempoolFeeColors = [
  '00ff66', // Vibrant Emerald
  '24fd5e',
  '39fb57',
  '49f94f',
  '58f747',
  '66f43e',
  '73f134',
  '80ee28',
  '8ceb18',
  '98e700', // Electric Lime
  'a6e200',
  'b3dd00',
  'c0d700',
  'ccd200',
  'd9cc00',
  'e5c500',
  'f1be00',
  'ffb700', // Vivid Amber
  'ffa912',
  'ff9b1e',
  'ff8c28',
  'ff7d31',
  'ff6c39',
  'ff5a41',
  'ff4549',
  'ff2751', // Bright Coral
  'ff0059',
  'f90063',
  'f3006d',
  'ec0076',
  'e50080',
  'de0089',
  'd60092',
  'ce009b',
  'c600a3',
  'bd00ab',
  'b300b3', // Pure Magenta
  'a700bb',
  '9900c2', // Deep Electric Purple
];

export const chartColors = [
  '#A81524',
  '#D81B60',
  '#8E24AA',
  '#5E35B1',
  '#3949AB',
  '#1E88E5',
  '#039BE5',
  '#00ACC1',
  '#00897B',
  '#43A047',
  '#7CB342',
  '#C0CA33',
  '#FDD835',
  '#FFB300',
  '#FB8C00',
  '#F4511E',
  '#6D4C41',
  '#757575',
  '#546E7A',
  '#b71c1c',
  '#880E4F',
  '#4A148C',
  '#311B92',
  '#1A237E',
  '#0D47A1',
  '#01579B',
  '#006064',
  '#004D40',
  '#1B5E20',
  '#33691E',
  '#827717',
  '#F57F17',
  '#FF6F00',
  '#E65100',
  '#BF360C',
  '#3E2723',
  '#212121',
  '#263238',
  '#801313',
];
export const originalChartColors = chartColors.slice(1);

export const poolsColor = {
  unknown: '#FDD835',
};

export const feeLevels = [
  0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 125,
  150, 175, 200, 250, 300, 350, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400,
  1600, 1800, 2000,
];

export interface Language {
  code: string;
  name: string;
}

export const languages: Language[] = [
  { code: 'ar', name: 'العربية' }, // Arabic
  // { code: 'bg', name: 'Български' },       // Bulgarian
  // { code: 'bs', name: 'Bosanski' },        // Bosnian
  // { code: 'ca', name: 'Català' },          // Catalan
  { code: 'cs', name: 'Čeština' }, // Czech
  { code: 'da', name: 'Dansk' }, // Danish
  { code: 'de', name: 'Deutsch' }, // German
  // { code: 'et', name: 'Eesti' },           // Estonian
  // { code: 'el', name: 'Ελληνικά' },        // Greek
  { code: 'en-US', name: 'English' }, // English
  { code: 'es', name: 'Español' }, // Spanish
  // { code: 'eo', name: 'Esperanto' },       // Esperanto
  // { code: 'eu', name: 'Euskara' },         // Basque
  { code: 'fa', name: 'فارسی' }, // Persian
  { code: 'fr', name: 'Français' }, // French
  // { code: 'gl', name: 'Galego' },          // Galician
  { code: 'ko', name: '한국어' }, // Korean
  { code: 'hr', name: 'Hrvatski' }, // Croatian
  // { code: 'id', name: 'Bahasa Indonesia' },// Indonesian
  { code: 'hi', name: 'हिन्दी' }, // Hindi
  { code: 'ne', name: 'नेपाली' }, // Nepalese
  { code: 'it', name: 'Italiano' }, // Italian
  { code: 'he', name: 'עברית' }, // Hebrew
  { code: 'ka', name: 'ქართული' }, // Georgian
  // { code: 'lv', name: 'Latviešu' },        // Latvian
  { code: 'lt', name: 'Lietuvių' }, // Lithuanian
  { code: 'hu', name: 'Magyar' }, // Hungarian
  { code: 'mk', name: 'Македонски' }, // Macedonian
  // { code: 'ms', name: 'Bahasa Melayu' },   // Malay
  { code: 'nl', name: 'Nederlands' }, // Dutch
  { code: 'ja', name: '日本語' }, // Japanese
  { code: 'nb', name: 'Norsk' }, // Norwegian Bokmål
  // { code: 'nn', name: 'Norsk Nynorsk' }, // Norwegian Nynorsk
  { code: 'pl', name: 'Polski' }, // Polish
  { code: 'pt', name: 'Português' }, // Portuguese
  // { code: 'pt-BR', name: 'Português (Brazil)' }, // Portuguese (Brazil)
  { code: 'ro', name: 'Română' }, // Romanian
  { code: 'ru', name: 'Русский' }, // Russian
  // { code: 'sk', name: 'Slovenčina' },      // Slovak
  { code: 'sl', name: 'Slovenščina' }, // Slovenian
  // { code: 'sr', name: 'Српски / srpski' }, // Serbian
  // { code: 'sh', name: 'Srpskohrvatski / српскохрватски' },// Serbo-Croatian
  { code: 'fi', name: 'Suomi' }, // Finnish
  { code: 'sv', name: 'Svenska' }, // Swedish
  { code: 'th', name: 'ไทย' }, // Thai
  { code: 'tr', name: 'Türkçe' }, // Turkish
  { code: 'uk', name: 'Українська' }, // Ukrainian
  { code: 'vi', name: 'Tiếng Việt' }, // Vietnamese
  { code: 'zh-Hant', name: '繁體中文' }, // Traditional Chinese
  { code: 'zh-Hans', name: '简体中文' }, // Simplified Chinese
];

export const specialBlocks = {
  '0': {
    labelEvent: 'Genesis',
    labelEventCompleted: 'The Genesis of Bitcoin',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '74637': {
    labelEvent: 'Value overflow incident & rollback',
    labelEventCompleted:
      'Block 74638 contained a critical integer overflow exploit that allowed for the creation of 184 billion BTC. Satoshi Nakamoto coordinated an emergency patch, using block 74637 as the pivot point for a deliberate rollback—the only intentional intervention of its kind in Bitcoin’s history. Within 24 hours, the corrected chain overtook the exploit at block 74691, permanently orphaning the fraudulent branch.',
    networks: ['mainnet'],
  },
  '124721': {
    labelEvent: 'First miner burn',
    labelEventCompleted:
      "This block's coinbase claimed 4,999,999,999 satoshis instead of the maximum 5,001,000,000 (fees included), implicitly burning 1,000,001 satoshis.",
    networks: ['mainnet'],
  },
  '133471': {
    labelEvent: 'Biggest coinbase transaction',
    labelEventCompleted:
      'This block mined a coinbase transaction of 31,353, the biggest ever (as of 2026-01-14).',
    networks: ['mainnet'],
  },
  '210000': {
    labelEvent: "Bitcoin's 1st Halving",
    labelEventCompleted: 'Block Subsidy has halved to 25 BTC per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '409008': {
    labelEvent: 'Biggest fee',
    labelEventCompleted:
      'This block accumulated 29,153,275,103 satoshis in fees, the most ever (as of 2026-01-14).',
    networks: ['mainnet'],
  },
  '420000': {
    labelEvent: "Bitcoin's 2nd Halving",
    labelEventCompleted: 'Block Subsidy has halved to 12.5 BTC per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '478559': {
    labelEvent: 'BCH Independence Day; BTC-BCH Fork',
    labelEventCompleted:
      'Bitcoin Cash Independence Day (2017-08-01). BTC-BCH hard fork. First >1 MB Block. This marks the first block which set Bitcoin Cash (BCH) apart from Bitcoin (BTC) by being mined according to user-activated hard fork (UAHF) consensus rules. Increase blocksize limit to 8 MB. First block which tested the upgraded blocksize limit (1,915,175 bytes). Upgrade sigops limit to scale with blocksize. Introduce SIGHASH_FORKID replay protection and upgrade sighash algorithm to adapted BIP143. Enforce SCRIPT_VERIFY_STRICTENC malleability protection. Introduce emergency difficulty adjustment algorithm (EDAA). (https://upgradespecs.bitcoincashnode.org/uahf-technical-spec/)',
    networks: ['mainnet'],
  },
  '479469': {
    labelEvent: 'First 8 MB Block',
    labelEventCompleted:
      'First block mined near the upgraded blocksize limit (7,998,130 bytes).',
    networks: ['mainnet'],
  },
  '504032': {
    labelEvent: 'November 2017 Upgrade',
    labelEventCompleted:
      'New difficulty adjustment algorithm (DAA), CW-144. Signature malleability fixes (LOW_S, NULLFAIL). This marks the first block mined to satisfy upgraded consensus rules. (https://upgradespecs.bitcoincashnode.org/nov-13-hardfork-spec/)',
    networks: ['mainnet'],
  },
  '530356': {
    labelEvent: 'May 2018 Upgrade',
    labelEventCompleted:
      'Blocksize limit increase to 32 MB. Re-enable several opcodes (OP_CAT, OP_SPLIT, OP_AND, OP_OR, OP_XOR, OP_DIV, OP_MOD, OP_NUM2BIN, OP_BIN2NUM). This marks the first block mined to satisfy upgraded consensus rules. (https://upgradespecs.bitcoincashnode.org/may-2018-hardfork/)',
    networks: ['mainnet'],
  },
  '545958': {
    labelEvent: 'First >8 MB Block',
    labelEventCompleted:
      'First block which tested the upgraded blocksize limit (10,281,454 bytes).',
    networks: ['mainnet'],
  },
  '556034': {
    labelEvent: 'First 32 MB Block',
    labelEventCompleted:
      'First block mined near the upgraded blocksize limit (31,997,624 bytes).',
    networks: ['mainnet'],
  },
  '556767': {
    labelEvent: 'November 2018 Upgrade; BCH-BSV hard fork',
    labelEventCompleted:
      'Enforce canonical transaction order (CTOR). Introduce OP_CHECKDATASIG and OP_CHECKDATASIGVERIFY opcodes. Fix merkle tree vulnerability by enforcing minimum transaction size (100 bytes). Input script malleability fixes (PUSH_ONLY, CLEAN_STACK). This marks the first block mined to satisfy upgraded consensus rules. (https://upgradespecs.bitcoincashnode.org/2018-nov-upgrade/)',
    networks: ['mainnet'],
  },
  '582680': {
    labelEvent: 'May 2019 Upgrade',
    labelEventCompleted:
      'Enable Schnorr signatures for OP_CHECKSIG and OP_CHECKSIGVERIFY. Introduce exception to CLEAN_STACK rule to allow Segwit recovery. This marks the first block mined to satisfy upgraded consensus rules. (https://upgradespecs.bitcoincashnode.org/2019-05-15-upgrade/)',
    networks: ['mainnet'],
  },
  '609136': {
    labelEvent: 'November 2019 Upgrade',
    labelEventCompleted:
      'Enable Schnorr signatures for OP_CHECKMULTISIG and OP_CHECKMULTISIGVERIFY. Input script malleability fixes (MINIMALDATA). This marks the first block mined to satisfy upgraded consensus rules. (https://upgradespecs.bitcoincashnode.org/2019-11-15-upgrade/)',
    networks: ['mainnet'],
  },
  '630000': {
    labelEvent: "Bitcoin Cash's 3rd Halving",
    labelEventCompleted: 'Block Subsidy has halved to 6.25 BCH per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '635259': {
    labelEvent: 'May 2020 Upgrade',
    labelEventCompleted:
      'Replace script SigOps limits with SigChecks limits. Introduce OP_REVERSEBYTES. This marks the first block mined to satisfy upgraded consensus rules. (https://upgradespecs.bitcoincashnode.org/2020-05-15-upgrade/)',
    networks: ['mainnet'],
  },
  '661647': {
    labelEvent: 'Anchor block for ASERT-DAA',
    labelEventCompleted:
      'This block serves as the reference point for the Absolutely Scheduled Exponentially Rising Targets (aserti3-2d) algorithm. ASERT acts as a log-target accumulator of timing errors, using an exponential moving average with a specific half-life to calculate difficulty adjustments. This ensures stable 10-minute block times even with significant hash rate fluctuations, eliminating the volatility and oscillations of previous algorithms like CW-144.',
    networks: ['mainnet'],
  },
  '661648': {
    labelEvent: 'November 2020 Upgrade; BCH-XEC hard fork',
    labelEventCompleted:
      'Introduce absolutely scheduled exponentially rising targets difficulty adjustment algorithm (ASERT-DAA). This marks the first block mined to satisfy upgraded consensus rules. (https://upgradespecs.bitcoincashnode.org/2020-11-15-upgrade/)',
    networks: ['mainnet'],
  },
  '688094': {
    labelEvent: 'May 2021 Upgrade; First CHIP upgrade',
    labelEventCompleted:
      'This is the first network that included an upgrade resulting from CHIP process (https://gitlab.com/im_uname/cash-improvement-proposals/-/blob/master/CHIPs.md). Removal of the unconfirmed transaction chain limit. CHIP-2021-03-12 Multiple OP_RETURNs for Bitcoin Cash. This marks the first block mined after activating new relay rules. (https://upgradespecs.bitcoincashnode.org/2021-05-15-upgrade/)',
    networks: ['mainnet'],
  },
  '740238': {
    labelEvent: 'May 2022 Upgrade',
    labelEventCompleted:
      'CHIP-2021-03: Bigger Script Integers. CHIP-2021-02: Native Introspection Opcodes. This marks the first block mined to satisfy upgraded consensus rules. (https://upgradespecs.bitcoincashnode.org/2022-05-15-upgrade/)',
    networks: ['mainnet'],
  },
  '792773': {
    labelEvent: 'May 2023 Upgrade',
    labelEventCompleted:
      'CHIP-2021-01 Restrict Transaction Version. CHIP-2021-01 Minimum Transaction Size. CHIP-2022-02 CashTokens. CHIP-2022-05 P2SH32. This marks the first block mined to satisfy upgraded consensus rules. (https://upgradespecs.bitcoincashnode.org/2023-05-15-upgrade/)',
    networks: ['mainnet'],
  },
  '840000': {
    labelEvent: "Bitcoin Cash's 4th Halving",
    labelEventCompleted: 'Block Subsidy has halved to 3.125 BCH per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '845891': {
    labelEvent: 'May 2024 Upgrade',
    labelEventCompleted:
      'CHIP-2023-04 Adaptive Blocksize Limit Algorithm for Bitcoin Cash. This marks the first block mined to satisfy upgraded consensus rules. (https://upgradespecs.bitcoincashnode.org/2024-05-15-upgrade/)',
    networks: ['mainnet'],
  },
  '898374': {
    labelEvent: 'May 2025 Upgrade',
    labelEventCompleted:
      'CHIP-2021-05 VM Limits: Targeted Virtual Machine Limits. CHIP-2024-07 BigInt: High-Precision Arithmetic for Bitcoin Cash. This marks the first block mined to satisfy upgraded consensus rules. (https://upgradespecs.bitcoincashnode.org/2025-05-15-upgrade/)',
    networks: ['mainnet'],
  },
  '951144': {
    labelEvent: 'May 2026 Upgrade',
    labelEventCompleted:
      'CHIP-2024-12 P2S: Pay to Script. CHIP-2021-05 Loops: Bounded Looping Operations. CHIP-2025-05 Functions: Function Definition and Invocation Operations. CHIP-2025-05 Bitwise: Re-Enable Bitwise Operations. This marks the first block mined to satisfy upgraded consensus rules. (https://upgradespecs.bitcoincashnode.org/2026-05-15-upgrade/)',
    networks: ['mainnet'],
  },
  '1050000': {
    labelEvent: "Bitcoin Cash's 5th Halving",
    labelEventCompleted: 'Block Subsidy has halved to 1.5625 BCH per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '1260000': {
    labelEvent: "Bitcoin Cash's 6th Halving",
    labelEventCompleted: 'Block Subsidy has halved to 0.78125 BCH per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '1470000': {
    labelEvent: "Bitcoin Cash's 7th Halving",
    labelEventCompleted: 'Block Subsidy has halved to 0.390625 BCH per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '1680000': {
    labelEvent: "Bitcoin Cash's 8th Halving",
    labelEventCompleted: 'Block Subsidy has halved to 0.1953125 BCH per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '1890000': {
    labelEvent: "Bitcoin Cash's 9th Halving",
    labelEventCompleted: 'Block Subsidy has halved to 0.09765625 BCH per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '2100000': {
    labelEvent: "Bitcoin Cash's 10th Halving",
    labelEventCompleted: 'Block Subsidy has halved to 0.04882812 BCH per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '2310000': {
    labelEvent: "Bitcoin Cash's 11th Halving",
    labelEventCompleted: 'Block Subsidy has halved to 0.02441406 BCH per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '2520000': {
    labelEvent: "Bitcoin Cash's 12th Halving",
    labelEventCompleted: 'Block Subsidy has halved to 0.01220703 BCH per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '2730000': {
    labelEvent: "Bitcoin Cash's 13th Halving",
    labelEventCompleted: 'Block Subsidy has halved to 0.00610351 BCH per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '2940000': {
    labelEvent: "Bitcoin Cash's 14th Halving",
    labelEventCompleted: 'Block Subsidy has halved to 0.00305175 BCH per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
  '3150000': {
    labelEvent: "Bitcoin Cash's 15th Halving",
    labelEventCompleted: 'Block Subsidy has halved to 0.00152587 BCH per block',
    networks: ['mainnet', 'testnet4', 'scalenet', 'chipnet'],
  },
};

export const fiatCurrencies = {
  AUD: {
    name: 'Australian Dollar',
    code: 'AUD',
    indexed: true,
  },
  CAD: {
    name: 'Canadian Dollar',
    code: 'CAD',
    indexed: true,
  },
  CHF: {
    name: 'Swiss Franc',
    code: 'CHF',
    indexed: true,
  },
  EUR: {
    name: 'Euro',
    code: 'EUR',
    indexed: true,
  },
  GBP: {
    name: 'Pound Sterling',
    code: 'GBP',
    indexed: true,
  },
  JPY: {
    name: 'Japanese Yen',
    code: 'JPY',
    indexed: true,
  },
  USD: {
    name: 'US Dollar',
    code: 'USD',
    indexed: true,
  },
  BGN: {
    name: 'Bulgarian Lev',
    code: 'BGN',
    indexed: true,
  },
  BRL: {
    name: 'Brazilian Real',
    code: 'BRL',
    indexed: true,
  },
  CNY: {
    name: 'Chinese Yuan',
    code: 'CNY',
    indexed: true,
  },
  CZK: {
    name: 'Czech Koruna',
    code: 'CZK',
    indexed: true,
  },
  DKK: {
    name: 'Danish Krone',
    code: 'DKK',
    indexed: true,
  },
  HKD: {
    name: 'Hong Kong Dollar',
    code: 'HKD',
    indexed: true,
  },
  HRK: {
    name: 'Croatian Kuna',
    code: 'HRK',
    indexed: true,
  },
  HUF: {
    name: 'Hungarian Forint',
    code: 'HUF',
    indexed: true,
  },
  IDR: {
    name: 'Indonesian Rupiah',
    code: 'IDR',
    indexed: true,
  },
  ILS: {
    name: 'Israeli Shekel',
    code: 'ILS',
    indexed: true,
  },
  INR: {
    name: 'Indian Rupee',
    code: 'INR',
    indexed: true,
  },
  ISK: {
    name: 'Icelandic Krona',
    code: 'ISK',
    indexed: true,
  },
  KRW: {
    name: 'South Korean Won',
    code: 'KRW',
    indexed: true,
  },
  MXN: {
    name: 'Mexican Peso',
    code: 'MXN',
    indexed: true,
  },
  MYR: {
    name: 'Malaysian Ringgit',
    code: 'MYR',
    indexed: true,
  },
  NOK: {
    name: 'Norwegian Krone',
    code: 'NOK',
    indexed: true,
  },
  NZD: {
    name: 'New Zealand Dollar',
    code: 'NZD',
    indexed: true,
  },
  PHP: {
    name: 'Philippine Peso',
    code: 'PHP',
    indexed: true,
  },
  PLN: {
    name: 'Polish Zloty',
    code: 'PLN',
    indexed: true,
  },
  RON: {
    name: 'Romanian Leu',
    code: 'RON',
    indexed: true,
  },
  RUB: {
    name: 'Russian Ruble',
    code: 'RUB',
    indexed: true,
  },
  SEK: {
    name: 'Swedish Krona',
    code: 'SEK',
    indexed: true,
  },
  SGD: {
    name: 'Singapore Dollar',
    code: 'SGD',
    indexed: true,
  },
  THB: {
    name: 'Thai Baht',
    code: 'THB',
    indexed: true,
  },
  TRY: {
    name: 'Turkish Lira',
    code: 'TRY',
    indexed: true,
  },
  ZAR: {
    name: 'South African Rand',
    code: 'ZAR',
    indexed: true,
  },
};

export interface Timezone {
  offset: string;
  name: string;
}

export const timezones: Timezone[] = [
  { offset: '-12', name: 'Anywhere on Earth (AoE)' },
  { offset: '-11', name: 'Samoa Standard Time (SST)' },
  { offset: '-10', name: 'Hawaii Standard Time (HST)' },
  { offset: '-9', name: 'Alaska Standard Time (AKST)' },
  { offset: '-8', name: 'Pacific Standard Time (PST)' },
  { offset: '-7', name: 'Mountain Standard Time (MST)' },
  { offset: '-6', name: 'Central Standard Time (CST)' },
  { offset: '-5', name: 'Eastern Standard Time (EST)' },
  { offset: '-4', name: 'Atlantic Standard Time (AST)' },
  { offset: '-3', name: 'Argentina Time (ART)' },
  { offset: '-2', name: 'Fernando de Noronha Time (FNT)' },
  { offset: '-1', name: 'Azores Time (AZOT)' },
  { offset: '+0', name: 'Greenwich Mean Time (GMT)' },
  { offset: '+1', name: 'Central European Time (CET)' },
  { offset: '+2', name: 'Eastern European Time (EET)' },
  { offset: '+3', name: 'Moscow Standard Time (MSK)' },
  { offset: '+4', name: 'Armenia Time (AMT)' },
  { offset: '+5', name: 'Pakistan Standard Time (PKT)' },
  { offset: '+6', name: 'Xinjiang Time (XJT)' },
  { offset: '+7', name: 'Indochina Time (ICT)' },
  { offset: '+8', name: 'Hong Kong Time (HKT)' },
  { offset: '+9', name: 'Japan Standard Time (JST)' },
  { offset: '+10', name: 'Australian Eastern Standard Time (AEST)' },
  { offset: '+11', name: 'Norfolk Time (NFT)' },
  { offset: '+12', name: 'New Zealand Standard Time (NZST)' },
  { offset: '+13', name: 'Tonga Time (TOT)' },
  { offset: '+14', name: 'Line Islands Time (LINT)' },
];
