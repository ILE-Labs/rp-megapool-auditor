/**
 * Consensus Layer (Beacon Chain) parameters, epoch math, and validator credential utilities.
 */

export const NETWORK_CONFIGS = {
  mainnet: {
    genesisTime: 1606824023,
    secondsPerSlot: 12,
    slotsPerEpoch: 32,
    depositContractAddress: '0x00000000219ab540356cbb839cbe05303d7705fa'
  },
  holesky: {
    genesisTime: 1695902400,
    secondsPerSlot: 12,
    slotsPerEpoch: 32,
    depositContractAddress: '0x4242424242424242424242424242424242424242'
  },
  sepolia: {
    genesisTime: 1655733600,
    secondsPerSlot: 12,
    slotsPerEpoch: 32,
    depositContractAddress: '0x7f02c3e3c98b18fb05005b4b1a45fd8e2193b22b'
  },
  hoodi: {
    genesisTime: 1742213400,
    secondsPerSlot: 12,
    slotsPerEpoch: 32,
    depositContractAddress: '0x1111111111111111111111111111111111111111'
  }
};

/**
 * Calculates slot number for a given epoch.
 */
export function epochToSlot(epoch, slotsPerEpoch = 32) {
  return epoch * slotsPerEpoch;
}

/**
 * Calculates epoch for a given slot.
 */
export function slotToEpoch(slot, slotsPerEpoch = 32) {
  return Math.floor(slot / slotsPerEpoch);
}

/**
 * Estimates wall-clock timestamp for an epoch based on network genesis.
 */
export function estimateEpochTimestamp(epoch, network = 'holesky') {
  const config = NETWORK_CONFIGS[network] || NETWORK_CONFIGS.holesky;
  const slot = epochToSlot(epoch, config.slotsPerEpoch);
  return config.genesisTime + (slot * config.secondsPerSlot);
}

/**
 * Formats epoch target as relative duration and ISO timestamp.
 */
export function formatEpochProjection(targetEpoch, currentFinalizedEpoch, network = 'holesky') {
  if (targetEpoch === null || targetEpoch === undefined) return null;
  const config = NETWORK_CONFIGS[network] || NETWORK_CONFIGS.holesky;
  const remainingEpochs = targetEpoch - (currentFinalizedEpoch ?? targetEpoch);
  const remainingSeconds = remainingEpochs * config.slotsPerEpoch * config.secondsPerSlot;
  const targetTimestamp = estimateEpochTimestamp(targetEpoch, network);
  const targetDateStr = new Date(targetTimestamp * 1000).toISOString();

  if (remainingEpochs <= 0) {
    return `Epoch ${targetEpoch} (Finalized / Elapsed at ~${targetDateStr})`;
  }

  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  return `Epoch ${targetEpoch} (~${durationStr} remaining, est. ${targetDateStr})`;
}

/**
 * Extracts the 20-byte execution withdrawal address from 32-byte beacon withdrawal credentials.
 * Type 0x01 credentials: 0x010000000000000000000000<20-byte-eth1-address>
 */
export function extractWithdrawalAddress(withdrawalCredentials) {
  if (!withdrawalCredentials || typeof withdrawalCredentials !== 'string') return null;
  const clean = withdrawalCredentials.toLowerCase().replace(/^0x/, '');
  if (clean.length !== 64) return null;

  const credentialType = clean.slice(0, 2);
  if (credentialType === '01') {
    return '0x' + clean.slice(24);
  }
  return null;
}

/**
 * Verifies whether beacon withdrawal credentials match the expected Megapool contract address.
 */
export function verifyWithdrawalCredentials(withdrawalCredentials, expectedMegapoolAddress) {
  if (!withdrawalCredentials || !expectedMegapoolAddress) {
    return { valid: false, reason: 'Missing credentials or megapool address' };
  }
  const clean = withdrawalCredentials.toLowerCase().replace(/^0x/, '');
  const credentialType = clean.slice(0, 2);
  if (credentialType !== '01') {
    return {
      valid: false,
      reason: `Legacy BLS credential type (0x${credentialType}); not an execution address`
    };
  }

  const extractedAddress = '0x' + clean.slice(24);
  const matches = extractedAddress.toLowerCase() === expectedMegapoolAddress.toLowerCase();
  return {
    valid: matches,
    extractedAddress,
    expectedAddress: expectedMegapoolAddress.toLowerCase(),
    reason: matches ? 'Matches megapool contract' : `Credential mismatch: routes to ${extractedAddress} instead of ${expectedMegapoolAddress}`
  };
}
