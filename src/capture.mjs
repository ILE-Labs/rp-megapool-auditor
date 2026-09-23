#!/usr/bin/env node
/**
 * rp-megapool-auditor capture mode
 *
 * Queries a live EL + CL RPC pair, saves every raw HTTP response with
 * timestamps, endpoint metadata, and request details to a capture bundle.
 * The bundle is a self-contained directory that can be inspected, shared,
 * and replayed without a network connection.
 *
 * Usage:
 *   node src/capture.mjs \
 *     --megapool 0x<ADDRESS> \
 *     --el-rpc https://... \
 *     --cl-rpc https://... \
 *     --network holesky \
 *     --out capture/
 */

import fs from 'node:fs';
import path from 'node:path';
import { encodeGetValidatorCount, encodeGetValidatorDetails, decodeValidatorInfoAndPubkey } from './megapool.mjs';
import { decodeUint256, splitWords, decodeBool } from './evm.mjs';
import { fetchBeaconFinalizedEpoch, verifyMegapoolDeployment, verifyMegapoolProvenance } from './adapters.mjs';

function printHelp() {
  console.log(`
rp-megapool-auditor capture: Fetch and archive raw live RPC responses.

USAGE:
  node src/capture.mjs \\
    --megapool 0x<REAL_MEGAPOOL_ADDRESS> \\
    --el-rpc   https://<EXECUTION_RPC> \\
    --cl-rpc   https://<BEACON_REST> \\
    --network  holesky \\
    --out      capture/

OPTIONS:
  --megapool <address>   Megapool contract address
  --el-rpc <url>         Execution-layer JSON-RPC endpoint
  --cl-rpc <url>         Consensus-layer Beacon REST endpoint
  --network <name>       Network name (holesky | mainnet | hoodi)
  --val-index <n>        Validator slot index inside Megapool (default: 0)
  --block <tag>          EL block tag (default: latest)
  --chain-id <number>    Expected EL chain ID (recommended for live captures)
  --rocket-storage <address> Canonical RocketStorage address (optional override)
  --protocol-version <v> Protocol ruleset pin (default: saturn-1)
  --out <dir>            Output directory for capture bundle (default: capture/)
  --help                 Show this help

WHAT IS SAVED:
  <out>/capture-metadata.json    Endpoint URLs, timestamps, network
  <out>/el-block-number.json     Raw eth_blockNumber response
  <out>/el-validator-count.json  Raw eth_call getValidatorCount() response
  <out>/el-validator-<n>.json    Raw eth_call getValidatorDetails(n) response
  <out>/cl-finalized-header.json Raw Beacon /eth/v1/beacon/headers/finalized
  <out>/cl-validator-<idx>.json  Raw Beacon /eth/v1/beacon/states/finalized/validators/<idx>
  <out>/snapshot.json            Reconciler input (passed directly to reconcile())
  <out>/report.json              Canonical evidence report (JSON)
  <out>/report.md                Markdown evidence report
  <out>/report.terminal.txt      Terminal evidence report (no ANSI)
`);
}

async function timedFetch(url, init = {}) {
  const startMs = Date.now();
  const timestamp = new Date().toISOString();
  let status = null;
  let body = null;
  let error = null;
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(12000) });
    status = res.status;
    body = await res.text();
  } catch (e) {
    error = e.message;
  }
  const elapsedMs = Date.now() - startMs;
  return { url, timestamp, elapsedMs, status, body, error };
}

async function timedPost(url, payload) {
  return timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function parseJsonBody(raw) {
  try { return JSON.parse(raw.body); } catch { return null; }
}

function writeCapture(outDir, name, data) {
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function decodeValidatorSlot(hexData) {
  return decodeValidatorInfoAndPubkey(hexData);
}

function normalizeBeaconStatus(rawStatus, withdrawableEpoch, finalizedEpoch) {
  if (!rawStatus) return 'unknown';
  if (rawStatus.includes('withdrawn')) return 'withdrawal_done';
  if (rawStatus.includes('pending')) return rawStatus;
  if (rawStatus.includes('exit')) {
    if (withdrawableEpoch !== null && finalizedEpoch !== null && finalizedEpoch >= withdrawableEpoch) {
      return 'withdrawal_possible';
    }
    return 'exiting';
  }
  if (rawStatus.includes('active')) return 'active_ongoing';
  return rawStatus;
}

async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { printHelp(); process.exit(0); }

  const get = (f, d) => { const i = args.indexOf(`--${f}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
  const megapoolAddress = get('megapool', null);
  const elRpc = get('el-rpc', null);
  const clRpc = get('cl-rpc', null);
  const network = get('network', 'holesky');
  const valSlot = parseInt(get('val-index', '0'), 10);
  const blockTag = get('block', 'latest');
  const expectedChainIdRaw = get('chain-id', null);
  const expectedChainId = expectedChainIdRaw === null ? null : Number(expectedChainIdRaw);
  const rocketStorageAddress = get('rocket-storage', null);
  const protocolVersion = get('protocol-version', 'saturn-1');
  const outDir = get('out', 'capture');

  if (!megapoolAddress || !elRpc || !clRpc) {
    console.error('ERROR: --megapool, --el-rpc, and --cl-rpc are all required.\n');
    printHelp();
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const captureStart = new Date().toISOString();
  console.log(`[capture] Starting live capture`);
  console.log(`[capture] Network:  ${network}`);
  console.log(`[capture] Megapool: ${megapoolAddress}`);
  console.log(`[capture] EL RPC:   ${elRpc}`);
  console.log(`[capture] CL RPC:   ${clRpc.replace(/\/+$/, '')}`);
  console.log(`[capture] Val slot: ${valSlot}`);
  console.log(`[capture] Expected chain: ${expectedChainId ?? 'not pinned'}`);
  console.log(`[capture] Output:   ${outDir}/`);
  console.log('');

  // ── Deployment identity checks ─────────────────────────────────────────
  console.log('[capture] EL: verifying address, chain ID, and bytecode ...');
  const deployment = await verifyMegapoolDeployment({
    rpcUrl: elRpc,
    megapoolAddress,
    blockTag,
    expectedChainId
  });
  const provenance = await verifyMegapoolProvenance({
    rpcUrl: elRpc, megapoolAddress, network, blockTag, rocketStorageAddress
  });
  writeCapture(outDir, 'el-provenance-verification.json', provenance);
  console.log(`         → canonical=${provenance.valid ? 'verified' : 'not verified'}${provenance.error ? ` (${provenance.error})` : ''}`);
  writeCapture(outDir, 'el-deployment-verification.json', deployment);
  console.log(`         → chain ${deployment.chainId ?? 'FAILED'}, code=${deployment.codePresent ? 'present' : 'absent'}, valid=${deployment.valid}`);

  // ── EL: eth_blockNumber ──────────────────────────────────────────────────
  console.log('[capture] EL: eth_blockNumber ...');
  const blockRaw = await timedPost(elRpc, { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
  writeCapture(outDir, 'el-block-number.json', blockRaw);
  const blockJson = parseJsonBody(blockRaw);
  const executionBlock = blockJson?.result ? parseInt(blockJson.result, 16) : null;
  console.log(`         → block ${executionBlock ?? 'FAILED'} (${blockRaw.elapsedMs}ms, status ${blockRaw.status ?? 'error'})`);
  if (blockRaw.error) console.log(`         ERROR: ${blockRaw.error}`);

  // ── EL: getValidatorCount() ──────────────────────────────────────────────
  console.log('[capture] EL: eth_call getValidatorCount() ...');
  const countCallData = encodeGetValidatorCount();
  const countRaw = await timedPost(elRpc, {
    jsonrpc: '2.0', id: 2, method: 'eth_call',
    params: [{ to: megapoolAddress, data: countCallData }, blockTag]
  });
  writeCapture(outDir, 'el-validator-count.json', { ...countRaw, calldata: countCallData });
  const countJson = parseJsonBody(countRaw);
  const validatorCount = countJson?.result && countJson.result !== '0x'
    ? Number(decodeUint256(countJson.result)) : 1;
  console.log(`         → count ${validatorCount} (${countRaw.elapsedMs}ms, status ${countRaw.status ?? 'error'})`);
  if (countRaw.error) console.log(`         ERROR: ${countRaw.error}`);

  // ── EL: getValidatorInfoAndPubkey(valSlot) ──────────────────────────────
  console.log(`[capture] EL: eth_call getValidatorInfoAndPubkey(${valSlot}) ...`);
  const detailCallData = encodeGetValidatorDetails(valSlot);
  const detailRaw = await timedPost(elRpc, {
    jsonrpc: '2.0', id: 3, method: 'eth_call',
    params: [{ to: megapoolAddress, data: detailCallData }, blockTag]
  });
  writeCapture(outDir, `el-validator-${valSlot}.json`, { ...detailRaw, calldata: detailCallData });
  const detailJson = parseJsonBody(detailRaw);
  const contractState = decodeValidatorSlot(detailJson?.result);
  if (contractState) {
    console.log(`         → beaconIndex=${contractState.beaconIndex} state=${contractState.state} exitNotified=${contractState.exitNotified}`);
  } else {
    console.log(`         → decode failed or empty return (${detailRaw.elapsedMs}ms)`);
    if (detailRaw.error) console.log(`         ERROR: ${detailRaw.error}`);
    if (detailJson?.error) console.log(`         RPC error: ${detailJson.error.message}`);
  }

  // ── CL: finalized header ─────────────────────────────────────────────────
  const clBase = clRpc.replace(/\/+$/, '');
  console.log('[capture] CL: GET /eth/v1/beacon/headers/finalized ...');
  const headerRaw = await timedFetch(`${clBase}/eth/v1/beacon/headers/finalized`, {
    headers: { Accept: 'application/json' }
  });
  writeCapture(outDir, 'cl-finalized-header.json', headerRaw);
  const headerJson = parseJsonBody(headerRaw);
  const finalizedSlot = parseInt(headerJson?.data?.header?.message?.slot ?? '0', 10);
  const finalizedEpoch = Math.floor(finalizedSlot / 32);
  console.log(`         → slot ${finalizedSlot}, epoch ${finalizedEpoch} (${headerRaw.elapsedMs}ms, status ${headerRaw.status ?? 'error'})`);
  if (headerRaw.error) console.log(`         ERROR: ${headerRaw.error}`);

  // ── CL: validator state ──────────────────────────────────────────────────
  const beaconTarget = contractState?.pubkey || contractState?.beaconIndex || valSlot;
  console.log(`[capture] CL: GET /eth/v1/beacon/states/finalized/validators/${beaconTarget} ...`);
  const valRaw = await timedFetch(
    `${clBase}/eth/v1/beacon/states/finalized/validators/${beaconTarget}`,
    { headers: { Accept: 'application/json' } }
  );
  writeCapture(outDir, `cl-validator-${beaconTarget}.json`, valRaw);
  const valJson = parseJsonBody(valRaw);
  console.log(`         → status ${valRaw.status ?? 'error'} (${valRaw.elapsedMs}ms)`);
  if (valRaw.error) console.log(`         ERROR: ${valRaw.error}`);

  // ── Build beacon state ───────────────────────────────────────────────────
  let beaconState = null;
  if (valRaw.status === 404) {
    beaconState = {
      validatorIndex: beaconTarget,
      status: 'not_found',
      slashed: false,
      activationEpoch: null,
      exitEpoch: null,
      withdrawableEpoch: null,
      withdrawalCredentials: null,
      finalizedEpoch,
      withdrawn: false
    };
  } else if (valJson?.data?.validator) {
    const v = valJson.data.validator;
    const rawStatus = valJson.data.status || '';
    const MAX_EPOCH = '18446744073709551615';
    const exitEpoch = v.exit_epoch && v.exit_epoch !== MAX_EPOCH ? parseInt(v.exit_epoch, 10) : null;
    const withdrawableEpoch = v.withdrawable_epoch && v.withdrawable_epoch !== MAX_EPOCH
      ? parseInt(v.withdrawable_epoch, 10) : null;
    beaconState = {
      validatorIndex: valJson.data.index ? parseInt(valJson.data.index, 10) : beaconTarget,
      pubkey: v.pubkey || null,
      status: normalizeBeaconStatus(rawStatus, withdrawableEpoch, finalizedEpoch),
      rawStatus,
      slashed: v.slashed === true,
      activationEpoch: v.activation_epoch ? parseInt(v.activation_epoch, 10) : null,
      exitEpoch,
      withdrawableEpoch,
      withdrawalCredentials: v.withdrawal_credentials || null,
      finalizedEpoch,
      withdrawn: rawStatus.includes('withdrawn')
    };
    console.log(`         → validatorStatus=${rawStatus} normalized=${beaconState.status} index=${beaconState.validatorIndex}`);
  } else if (valRaw.status === 200 || valRaw.status === null) {
    console.log('         → could not parse beacon response; beacon will be INCONCLUSIVE');
  }

  // ── Assemble snapshot ────────────────────────────────────────────────────
  const snapshot = {
    metadata: {
      network,
      megapoolAddress,
      validatorSlot: valSlot,
      executionBlock,
      protocolVersion,
      capturedAt: captureStart,
      generatedAt: captureStart,
      elRpcUrl: elRpc,
      clRpcUrl: clBase,
      elBlockTag: blockTag,
      expectedChainId,
      deployment,
      provenance
    },
    contract: contractState
      ? { ...contractState, validatorId: `slot-${valSlot}` }
      : {
          validatorId: `slot-${valSlot}`,
          beaconIndex: null,
          state: 'unknown',
          exitNotified: null,
          balanceFinalized: null,
          dissolved: null,
          readError: 'current Megapool validator response could not be decoded'
        },
    beacon: beaconState
  };

  writeCapture(outDir, 'snapshot.json', snapshot);

  // ── Run reconciler ───────────────────────────────────────────────────────
  const { reconcile, toMarkdown, toTerminal } = await import('./reconcile.mjs');
  const report = reconcile(snapshot);

  writeCapture(outDir, 'report.json', report);
  fs.writeFileSync(path.join(outDir, 'report.md'), toMarkdown(report), 'utf8');
  // Terminal without ANSI escape codes
  const terminalOutput = toTerminal(report).replace(/\x1b\[[0-9;]*m/g, '');
  fs.writeFileSync(path.join(outDir, 'report.terminal.txt'), terminalOutput, 'utf8');

  // ── Capture metadata ─────────────────────────────────────────────────────
  writeCapture(outDir, 'capture-metadata.json', {
    capturedAt: captureStart,
    completedAt: new Date().toISOString(),
    network,
    megapoolAddress,
    validatorSlot: valSlot,
    beaconIndexQueried: beaconTarget,
    elRpcUrl: elRpc,
    clRpcUrl: clBase,
    elBlockTag: blockTag,
    expectedChainId,
    protocolVersion,
    deployment,
    provenance,
    executionBlock,
    finalizedEpoch,
    overallStatus: report.findings[0]?.status ?? 'UNKNOWN',
    ruleId: report.findings[0]?.ruleId ?? null,
    files: [
      'capture-metadata.json',
      'el-block-number.json',
      'el-validator-count.json',
      `el-validator-${valSlot}.json`,
      'cl-finalized-header.json',
      `cl-validator-${beaconTarget}.json`,
      'el-deployment-verification.json',
      'el-provenance-verification.json',
      'snapshot.json',
      'report.json',
      'report.md',
      'report.terminal.txt'
    ]
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log(`CAPTURE COMPLETE`);
  console.log(`  Network:         ${network}`);
  console.log(`  Megapool:        ${megapoolAddress}`);
  console.log(`  Execution block: ${executionBlock ?? 'UNAVAILABLE'}`);
  console.log(`  Finalized epoch: ${finalizedEpoch}`);
  console.log(`  Contract state:  ${contractState?.state ?? 'DECODE FAILED'}`);
  console.log(`  Beacon status:   ${beaconState?.status ?? 'UNAVAILABLE'}`);
  console.log(`  Finding:         ${report.findings[0]?.ruleId} → ${report.findings[0]?.status}`);
  console.log(`  Output dir:      ${outDir}/`);
  console.log('══════════════════════════════════════════════════');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Inspect capture/*.json to verify raw RPC responses.');
  console.log('  2. Run: rocketpool megapool status > capture/smartnode-status.txt');
  console.log('     and: rocketpool megapool validators >> capture/smartnode-status.txt');
  console.log('  3. Post capture/report.md + capture/smartnode-status.txt to the');
  console.log('     Rocket Pool Discord #node-operator-dev for operator feedback.');
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
