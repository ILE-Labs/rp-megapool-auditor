#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { reconcile, toMarkdown, toTerminal } from './reconcile.mjs';
import { fetchCrossLayerSnapshot } from './adapters.mjs';

function printHelp() {
  console.log(`
rp-megapool-auditor: Read-only evidence-backed cross-layer reconciler for Rocket Pool Megapools

USAGE:
  # Run offline against a deterministic fixture:
  node src/cli.mjs --fixture fixtures/withdrawable.json [--format terminal|json|markdown]

  # Run against execution & beacon RPC endpoints:
  node src/cli.mjs --megapool 0x... --el-rpc http://... --cl-rpc http://... [--network holesky] [--format json]

OPTIONS:
  --fixture <path>              Path to offline fixture JSON file (default: fixtures/healthy.json)
  --megapool <address>          Megapool contract address on the execution layer
  --el-rpc, --execution-rpc <url>  Execution-layer JSON-RPC endpoint URL
  --cl-rpc, --beacon-rpc <url>  Consensus-layer Beacon REST endpoint URL
  --validator-id <id>           Validator ID or pubkey/index filter
  --block <number|tag>          Execution block tag or number (default: latest)
  --network <name>              Ethereum network name (default: holesky)
  --protocol-version <version>  Protocol version pin (default: saturn-1)
  --explorer-base-url <url>     Base URL for execution explorer links
  --cl-explorer-base-url <url>  Base URL for consensus explorer links
  --format <format>             Output format: terminal, json, or markdown (default: terminal)
  --help, -h                    Show this help message

SAFETY GUARANTEES:
  - Strict read-only operation.
  - No private keys or signing capabilities.
  - Missing beacon RPC data emits INCONCLUSIVE; never converted into negative findings.
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const get = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };

  const fixture = get('fixture', null);
  const elRpc = get('el-rpc', get('execution-rpc', null));
  const clRpc = get('cl-rpc', get('beacon-rpc', null));
  const megapoolAddress = get('megapool', null);
  const validatorId = get('validator-id', null);
  const blockTag = get('block', 'latest');
  const network = get('network', 'holesky');
  const protocolVersion = get('protocol-version', 'saturn-1');
  const explorerBaseUrl = get('explorer-base-url', null);
  const clExplorerBaseUrl = get('cl-explorer-base-url', null);
  const format = get('format', 'terminal');

  let input;

  if (elRpc && clRpc && megapoolAddress) {
    try {
      input = await fetchCrossLayerSnapshot({
        megapoolAddress,
        elRpcUrl: elRpc,
        clRpcUrl: clRpc,
        validatorId,
        blockTag,
        network,
        protocolVersion,
        explorerBaseUrl,
        clExplorerBaseUrl
      });
    } catch (err) {
      console.error(`Error connecting to RPC endpoints: ${err.message}`);
      process.exit(1);
    }
  } else {
    const fixturePath = fixture || 'fixtures/healthy.json';
    try {
      input = JSON.parse(fs.readFileSync(path.resolve(fixturePath), 'utf8'));
    } catch (err) {
      console.error(`Error reading fixture file '${fixturePath}': ${err.message}`);
      process.exit(1);
    }
  }

  const report = reconcile(input);

  if (format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else if (format === 'markdown') {
    console.log(toMarkdown(report));
  } else {
    console.log(toTerminal(report));
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
