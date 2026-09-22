import { encodeFunctionCall, splitWords, decodeUint256, decodeBool, decodeAddress, toFunctionSelector } from './evm.mjs';

/**
 * Rocket Pool Saturn 1 Megapool Contract Definitions and ABI Selectors.
 */

export const MEGAPOOL_SIGNATURES = {
  getValidatorCount: 'getValidatorCount()',
  getValidatorInfo: 'getValidatorInfo(uint32)',
  getValidatorInfoAndPubkey: 'getValidatorInfoAndPubkey(uint32)',
  getValidatorPubkey: 'getValidatorPubkey(uint32)',
  isDissolved: 'isDissolved()',
  getNodeAddress: 'getNodeAddress()',
  getStakingDuration: 'getStakingDuration()',
  getTotalEffectiveBalance: 'getTotalEffectiveBalance()'
};

// These selectors are taken from the current RocketMegapoolDelegate ABI.
// Do not derive them with NIST SHA-3: Ethereum uses Keccak-256.
export const MEGAPOOL_SELECTORS = {
  getValidatorCount: '0x7071688a',
  getValidatorInfo: '0x81c1381b',
  getValidatorInfoAndPubkey: '0xa73f23b6',
  getValidatorPubkey: '0x0e335206'
};

export const VALIDATOR_STATES = {
  0: 'uninitialized',
  1: 'pending_assignment',
  2: 'active',
  3: 'exit_in_progress',
  4: 'withdrawn',
  5: 'dissolved'
};

export function encodeGetValidatorCount() {
  return MEGAPOOL_SELECTORS.getValidatorCount;
}

export function encodeGetValidatorInfo(validatorIndex) {
  return MEGAPOOL_SELECTORS.getValidatorInfo + BigInt(validatorIndex).toString(16).padStart(64, '0');
}

export function encodeGetValidatorInfoAndPubkey(validatorIndex) {
  return MEGAPOOL_SELECTORS.getValidatorInfoAndPubkey + BigInt(validatorIndex).toString(16).padStart(64, '0');
}

export function encodeIsDissolved() {
  return encodeFunctionCall(MEGAPOOL_SIGNATURES.isDissolved);
}

export function encodeGetNodeAddress() {
  return encodeFunctionCall(MEGAPOOL_SIGNATURES.getNodeAddress);
}

/**
 * Decodes the current `getValidatorInfoAndPubkey(uint32)` return value.
 *
 * ValidatorInfo is a 14-word static tuple in the current Saturn ABI and the
 * pubkey is a dynamic bytes value following the tuple head. The validator ID
 * is an internal Megapool slot; it is not a Beacon validator index.
 */
export function decodeValidatorInfoAndPubkey(hexData) {
  if (!hexData || hexData === '0x' || hexData.length < 66) {
    return null;
  }

  const words = splitWords(hexData);
  // Compatibility decoder for the repository's pre-Saturn mock fixtures.
  // Live Saturn responses take the 15-word path below and include a pubkey.
  if (words.length < 15) {
    if (words.length < 5) return null;
    const stateCode = Number(decodeUint256(words[1]));
    return {
      beaconIndex: Number(decodeUint256(words[0])),
      pubkey: null,
      state: VALIDATOR_STATES[stateCode] || `unknown_state_${stateCode}`,
      stateCode,
      exitNotified: decodeBool(words[2]),
      balanceFinalized: decodeBool(words[3]),
      dissolved: decodeBool(words[4]),
      dissolutionEpoch: words[5] ? Number(decodeUint256(words[5])) : null,
      lastDistributionTime: words[6] ? Number(decodeUint256(words[6])) : null
    };
  }

  const info = {
    lastAssignmentTime: Number(decodeUint256(words[0])),
    lastRequestedValue: Number(decodeUint256(words[1])),
    lastRequestedBond: Number(decodeUint256(words[2])),
    depositValue: Number(decodeUint256(words[3])),
    staked: decodeBool(words[4]),
    exited: decodeBool(words[5]),
    inQueue: decodeBool(words[6]),
    inPrestake: decodeBool(words[7]),
    expressUsed: decodeBool(words[8]),
    dissolved: decodeBool(words[9]),
    exiting: decodeBool(words[10]),
    locked: decodeBool(words[11]),
    exitBalance: Number(decodeUint256(words[12])),
    lockedTime: Number(decodeUint256(words[13]))
  };

  const dynamicOffset = Number(decodeUint256(words[14]));
  const clean = hexData.replace(/^0x/, '');
  const lengthOffset = dynamicOffset * 2;
  if (!Number.isSafeInteger(dynamicOffset) || lengthOffset + 64 > clean.length) return null;
  const pubkeyLength = Number(BigInt(`0x${clean.slice(lengthOffset, lengthOffset + 64)}`));
  const pubkeyStart = lengthOffset + 64;
  if (!Number.isSafeInteger(pubkeyLength) || pubkeyStart + pubkeyLength * 2 > clean.length) return null;
  const pubkey = `0x${clean.slice(pubkeyStart, pubkeyStart + pubkeyLength * 2)}`;

  let state = 'uninitialized';
  if (info.dissolved) state = 'dissolved';
  else if (info.exited) state = 'withdrawn';
  else if (info.exiting) state = 'exit_in_progress';
  else if (info.staked) state = 'active';
  else if (info.inPrestake) state = 'prestaked';
  else if (info.inQueue) state = 'pending_assignment';

  return {
    ...info,
    pubkey,
    state,
    beaconIndex: null,
    exitNotified: null,
    balanceFinalized: null,
    dissolutionEpoch: null,
    lastDistributionTime: null
  };
}

// Retained only for older fixture compatibility. Live reads must use the
// current getValidatorInfoAndPubkey decoder above.
export const decodeValidatorDetails = decodeValidatorInfoAndPubkey;
export const encodeGetValidatorDetails = encodeGetValidatorInfoAndPubkey;
