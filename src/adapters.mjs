import {
  encodeGetValidatorInfoAndPubkey,
  decodeValidatorInfoAndPubkey,
  encodeGetValidatorCount,
  ROCKET_POOL_REGISTRY_KEYS,
  ROCKET_POOL_SELECTORS,
  ROCKET_STORAGE_BY_NETWORK
} from './megapool.mjs';
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

export function isEvmAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export async function verifyMegapoolDeployment({ rpcUrl, megapoolAddress, blockTag = 'latest', expectedChainId = null }) {
  const addressValid = isEvmAddress(megapoolAddress);
  if (!addressValid) {
    return { addressValid: false, chainId: null, expectedChainId, codePresent: false, valid: false, error: 'invalid EVM address' };
  }

  try {
    const [chainResponse, codeResponse] = await Promise.all([
      fetch(rpcUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'eth_chainId', params: [] })
      }),
      fetch(rpcUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'eth_getCode', params: [megapoolAddress, blockTag] })
      })
    ]);
    if (!chainResponse.ok || !codeResponse.ok) throw new Error('execution RPC rejected deployment checks');
    const chainJson = await chainResponse.json();
    const codeJson = await codeResponse.json();
    const chainId = chainJson.result ? Number.parseInt(chainJson.result, 16) : null;
    const codePresent = typeof codeJson.result === 'string' && codeJson.result !== '0x' && !/^0x0+$/i.test(codeJson.result);
    const chainMatches = expectedChainId === null || expectedChainId === undefined || chainId === Number(expectedChainId);
    return {
      addressValid, chainId, expectedChainId: expectedChainId === null ? null : Number(expectedChainId),
      codePresent, chainMatches, valid: addressValid && codePresent && chainMatches,
      error: null
    };
  } catch (error) {
    return { addressValid, chainId: null, expectedChainId, codePresent: false, valid: false, error: error.message };
  }
}

function encodeAddressArgument(address) {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function decodeAddressResult(result) {
  if (typeof result !== 'string' || result.length < 42 || /^0x0*$/i.test(result)) return null;
  return `0x${result.slice(-40).toLowerCase()}`;
}

function decodeBoolResult(result) {
  return typeof result === 'string' && BigInt(result) !== 0n;
}

/**
 * Prove that the address is the canonical Rocket Pool Megapool for its node.
 * This follows the live RocketStorage -> Factory/NodeManager registry and
 * compares both canonical address paths, rather than trusting bytecode alone.
 */
export async function verifyMegapoolProvenance({
  rpcUrl,
  megapoolAddress,
  network = 'holesky',
  blockTag = 'latest',
  rocketStorageAddress = null
}) {
  const storage = (rocketStorageAddress || ROCKET_STORAGE_BY_NETWORK[network] || '').toLowerCase();
  const base = {
    checked: false, valid: false, network,
    rocketStorageAddress: storage || null,
    nodeManagerAddress: null, factoryAddress: null, nodeAddress: null,
    expectedMegapoolAddress: null, mappedMegapoolAddress: null,
    factoryDeploymentFlag: null, checks: {}, error: null
  };
  if (!storage) return { ...base, error: 'no canonical RocketStorage address configured for network' };
  if (!isEvmAddress(megapoolAddress) || !isEvmAddress(storage)) {
    return { ...base, error: 'invalid Megapool or RocketStorage address' };
  }
  try {
    const storageCall = (key) => ethCall({
      rpcUrl,
      to: storage,
      data: ROCKET_POOL_SELECTORS.rocketStorageGetAddress + key.replace(/^0x/, ''),
      blockTag
    });
    const [nodeManagerRaw, factoryRaw, nodeRaw] = await Promise.all([
      storageCall(ROCKET_POOL_REGISTRY_KEYS.rocketNodeManager),
      storageCall(ROCKET_POOL_REGISTRY_KEYS.rocketMegapoolFactory),
      ethCall({ rpcUrl, to: megapoolAddress, data: ROCKET_POOL_SELECTORS.megapoolGetNodeAddress, blockTag })
    ]);
    const nodeManagerAddress = decodeAddressResult(nodeManagerRaw);
    const factoryAddress = decodeAddressResult(factoryRaw);
    const nodeAddress = decodeAddressResult(nodeRaw);
    if (!nodeManagerAddress || !factoryAddress || !nodeAddress) {
      return { ...base, checked: true, nodeManagerAddress, factoryAddress, nodeAddress,
        error: 'Rocket Pool registry or Megapool node getter returned no address' };
    }
    const arg = encodeAddressArgument(nodeAddress);
    const [expectedRaw, mappedRaw, deployedRaw] = await Promise.all([
      ethCall({ rpcUrl, to: factoryAddress, data: ROCKET_POOL_SELECTORS.megapoolFactoryGetExpectedAddress + arg, blockTag }),
      ethCall({ rpcUrl, to: nodeManagerAddress, data: ROCKET_POOL_SELECTORS.nodeManagerGetMegapoolAddress + arg, blockTag }),
      ethCall({ rpcUrl, to: factoryAddress, data: ROCKET_POOL_SELECTORS.megapoolFactoryGetMegapoolDeployed + arg, blockTag })
    ]);
    const expectedMegapoolAddress = decodeAddressResult(expectedRaw);
    const mappedMegapoolAddress = decodeAddressResult(mappedRaw);
    const factoryDeploymentFlag = deployedRaw ? decodeBoolResult(deployedRaw) : null;
    const target = megapoolAddress.toLowerCase();
    const checks = {
      nodeGetterReturnedAddress: true,
      expectedAddressMatches: expectedMegapoolAddress === target,
      nodeManagerMappingMatches: mappedMegapoolAddress === target,
      factoryDeploymentFlag: factoryDeploymentFlag === true
    };
    return { ...base, checked: true, valid: Object.values(checks).every(Boolean),
      nodeManagerAddress, factoryAddress, nodeAddress, expectedMegapoolAddress,
      mappedMegapoolAddress, factoryDeploymentFlag, checks };
  } catch (error) {
    return { ...base, checked: true, error: error.message };
  }
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

export function normalizeBeaconStatus(rawStatus, withdrawableEpoch, finalizedEpoch) {
  if (!rawStatus) return 'unknown';
  if (rawStatus.includes('withdrawn')) return 'withdrawal_done';
  if (rawStatus.includes('exit')) {
    return (withdrawableEpoch !== null && finalizedEpoch !== null && finalizedEpoch >= withdrawableEpoch)
      ? 'withdrawal_possible'
      : 'exiting';
  }
  if (rawStatus.includes('active')) return 'active_ongoing';
  return rawStatus;
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

    const normalizedStatus = normalizeBeaconStatus(rawStatus, withdrawableEpoch, finalizedEpoch);

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
  ,expectedChainId = null,
  rocketStorageAddress = null
}) {
  const deployment = await verifyMegapoolDeployment({
    rpcUrl: elRpcUrl,
    megapoolAddress,
    blockTag,
    expectedChainId
  });
  const provenance = await verifyMegapoolProvenance({
    rpcUrl: elRpcUrl, megapoolAddress, network, blockTag, rocketStorageAddress
  });
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
      deployment,
      provenance,
      explorerBaseUrl,
      clExplorerBaseUrl,
      generatedAt: new Date().toISOString()
    },
    contract: elData.contractState,
    beacon: beaconData
  };
}
