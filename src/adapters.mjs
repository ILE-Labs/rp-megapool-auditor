import { encodeGetValidatorInfoAndPubkey, decodeValidatorInfoAndPubkey, encodeGetValidatorCount } from './megapool.mjs';
import { decodeUint256 } from './evm.mjs';

/**
 * Read-only Execution Layer (JSON-RPC) and Consensus Layer (Beacon REST) adapters.
 * Implements real EVM ABI encoding/decoding and Ethereum Beacon REST specifications.
 */

export async function fetchExecutionBlockNumber(rpcUrl) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: []
    })
  });
  if (!res.ok) {
    throw new Error(`Execution RPC HTTP ${res.status}: ${res.statusText}`);
  }
  const json = await res.json();
  return json.result ? parseInt(json.result, 16) : null;
}

export async function ethCall({ rpcUrl, to, data, blockTag = 'latest' }) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'eth_call',
      params: [{ to, data }, blockTag]
    })
  });
  if (!res.ok) {
    throw new Error(`eth_call HTTP ${res.status}: ${res.statusText}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`eth_call error: ${json.error.message || JSON.stringify(json.error)}`);
  }
  return json.result;
}

export async function fetchMegapoolValidatorCount({ rpcUrl, megapoolAddress, blockTag = 'latest' }) {
  try {
    const data = encodeGetValidatorCount();
    const resultHex = await ethCall({ rpcUrl, to: megapoolAddress, data, blockTag });
    if (resultHex && resultHex !== '0x') {
      return Number(decodeUint256(resultHex));
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchExecutionState({
  rpcUrl,
  megapoolAddress,
  validatorIndex = 0,
  validatorId = null,
  blockTag = 'latest'
}) {
  if (!rpcUrl) {
    throw new Error('Execution JSON-RPC URL is required');
  }

  const executionBlock = await fetchExecutionBlockNumber(rpcUrl);

  const validatorSlot = Number.isInteger(Number(validatorId)) ? Number(validatorId) : 0;

  // Query the current RocketMegapoolDelegate ABI via a real EVM eth_call.
  // A decode failure must never become an invented "active" state.
  try {
    const data = encodeGetValidatorInfoAndPubkey(validatorSlot);
    const resultHex = await ethCall({ rpcUrl, to: megapoolAddress, data, blockTag });
    const decoded = decodeValidatorInfoAndPubkey(resultHex);

    if (decoded) {
      return {
        executionBlock,
        contractState: {
          validatorId: validatorId || `slot-${validatorSlot}`,
          ...decoded
        }
      };
    }
  } catch {
    return {
      executionBlock,
      contractState: {
        validatorId: validatorId || `slot-${validatorSlot}`,
        beaconIndex: null,
        state: 'unknown',
        exitNotified: null,
        dissolved: null,
        dissolutionEpoch: null,
        balanceFinalized: null,
        readError: 'megapool validator details could not be decoded from the execution RPC response'
      }
    };
  }

  return {
    executionBlock,
    contractState: {
      validatorId: validatorId || `slot-${validatorSlot}`,
      beaconIndex: null,
      state: 'unknown',
      exitNotified: null,
      dissolved: null,
      dissolutionEpoch: null,
      balanceFinalized: null,
      readError: 'megapool validator details returned no decodable data'
    }
  };
}

export async function fetchBeaconFinalizedEpoch(beaconUrl) {
  const baseUrl = beaconUrl.replace(/\/+$/, '');
  try {
    const headerRes = await fetch(`${baseUrl}/eth/v1/beacon/headers/finalized`);
    if (headerRes.ok) {
      const headerJson = await headerRes.json();
      const slot = parseInt(headerJson.data?.header?.message?.slot ?? '0', 10);
      return Math.floor(slot / 32);
    }
  } catch {
    // Return null on failure
  }
  return null;
}

export async function fetchBeaconState({
  beaconUrl,
  validatorIndexOrPubkey
}) {
  if (!beaconUrl) {
    throw new Error('Beacon Chain REST URL is required');
  }

  const baseUrl = beaconUrl.replace(/\/+$/, '');
  const finalizedEpoch = await fetchBeaconFinalizedEpoch(beaconUrl);

  if (validatorIndexOrPubkey === null || validatorIndexOrPubkey === undefined) {
    return null;
  }

  try {
    const valRes = await fetch(
      `${baseUrl}/eth/v1/beacon/states/finalized/validators/${encodeURIComponent(validatorIndexOrPubkey)}`
    );

    if (valRes.status === 404) {
      return {
        validatorIndex: Number.isInteger(Number(validatorIndexOrPubkey)) ? Number(validatorIndexOrPubkey) : null,
        status: 'not_found',
        slashed: false,
        activationEpoch: null,
        exitEpoch: null,
        withdrawableEpoch: null,
        withdrawalCredentials: null,
        finalizedEpoch,
        withdrawn: false
      };
    }

    if (!valRes.ok) {
      return null;
    }

    const valJson = await valRes.json();
    const valData = valJson.data;
    if (!valData || !valData.validator) {
      return null;
    }

    const validator = valData.validator;
    const rawStatus = valData.status || '';
    const exitEpoch = validator.exit_epoch && validator.exit_epoch !== '18446744073709551615'
      ? parseInt(validator.exit_epoch, 10)
      : null;
    const withdrawableEpoch = validator.withdrawable_epoch && validator.withdrawable_epoch !== '18446744073709551615'
      ? parseInt(validator.withdrawable_epoch, 10)
      : null;

    let normalizedStatus = rawStatus;
    if (rawStatus.includes('active')) {
      normalizedStatus = 'active_ongoing';
    } else if (rawStatus.includes('exit') && !rawStatus.includes('withdrawn')) {
      normalizedStatus = (withdrawableEpoch !== null && finalizedEpoch !== null && finalizedEpoch >= withdrawableEpoch)
        ? 'withdrawal_possible'
        : 'exiting';
    } else if (rawStatus.includes('withdrawn')) {
      normalizedStatus = 'withdrawal_done';
    }

    return {
      validatorIndex: valData.index ? parseInt(valData.index, 10) : Number(validatorIndexOrPubkey),
      pubkey: validator.pubkey || null,
      status: normalizedStatus,
      slashed: validator.slashed === true || rawStatus.includes('slashed'),
      activationEpoch: validator.activation_epoch ? parseInt(validator.activation_epoch, 10) : null,
      exitEpoch,
      withdrawableEpoch,
      withdrawalCredentials: validator.withdrawal_credentials || null,
      finalizedEpoch,
      withdrawn: normalizedStatus === 'withdrawal_done'
    };
  } catch {
    return null;
  }
}

export async function fetchCrossLayerSnapshot({
  megapoolAddress,
  elRpcUrl,
  clRpcUrl,
  validatorId,
  blockTag = 'latest',
  network = 'holesky',
  protocolVersion = 'saturn-1',
  explorerBaseUrl,
  clExplorerBaseUrl
}) {
  const elData = await fetchExecutionState({
    rpcUrl: elRpcUrl,
    megapoolAddress,
    validatorId,
    blockTag
  });

  const beaconTarget = elData.contractState.pubkey || elData.contractState.beaconIndex || validatorId;
  const beaconData = await fetchBeaconState({
    beaconUrl: clRpcUrl,
    validatorIndexOrPubkey: beaconTarget
  });

  return {
    metadata: {
      network,
      megapoolAddress,
      validatorId: elData.contractState.validatorId || validatorId,
      executionBlock: elData.executionBlock,
      protocolVersion,
      explorerBaseUrl,
      clExplorerBaseUrl,
      generatedAt: new Date().toISOString()
    },
    contract: elData.contractState,
    beacon: beaconData
  };
}
