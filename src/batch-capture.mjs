#!/usr/bin/env node
/**
 * Evidence-preserving live batch capture.
 *
 * Each validator slot is captured by capture.mjs into its own directory. The
 * manifest then records the complete set of slot-level bundles. Sequential
 * execution is intentional: public RPC providers commonly rate-limit a
 * Megapool-sized Promise.all fan-out.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fetchMegapoolValidatorCount } from './adapters.mjs';

function value(args, name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function has(args, name) {
  return args.includes(`--${name}`);
}

function help() {
  console.log(`
rp-megapool-auditor batch capture

  node src/batch-capture.mjs --megapool 0x... --el-rpc https://... \
    --cl-rpc https://... --network hoodi --chain-id 560048 --out captures/batch

Captures every validator slot returned by getValidatorCount() into
<out>/slot-<n>/ and writes <out>/batch-manifest.json. Use --from/--to to
bound a large capture while preserving the slot numbers.
`);
}

function runCapture(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/capture.mjs', ...args], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`slot capture exited with ${code}`)));
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (has(args, 'help') || has(args, 'h')) return help();

  const megapool = value(args, 'megapool');
  const elRpc = value(args, 'el-rpc');
  const clRpc = value(args, 'cl-rpc');
  const out = value(args, 'out', 'capture-batch');
  if (!megapool || !elRpc || !clRpc) throw new Error('--megapool, --el-rpc, and --cl-rpc are required');

  const block = value(args, 'block', 'latest');
  const network = value(args, 'network', 'holesky');
  const chainId = value(args, 'chain-id', null);
  const protocolVersion = value(args, 'protocol-version', 'saturn-1');
  const from = Number(value(args, 'from', '0'));
  const count = await fetchMegapoolValidatorCount({ rpcUrl: elRpc, megapoolAddress: megapool, blockTag: block });
  const to = Number(value(args, 'to', String(count - 1)));
  if (!Number.isInteger(count) || count < 1) throw new Error('Megapool returned no validator slots');
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= count) {
    throw new Error(`slot range must be within 0..${count - 1}`);
  }

  fs.mkdirSync(out, { recursive: true });
  const slots = [];
  for (let slot = from; slot <= to; slot += 1) {
    const slotDir = path.join(out, `slot-${slot}`);
    const captureArgs = [
      '--megapool', megapool, '--el-rpc', elRpc, '--cl-rpc', clRpc,
      '--network', network, '--block', block, '--val-index', String(slot),
      '--out', slotDir, '--protocol-version', protocolVersion
    ];
    if (chainId !== null) captureArgs.push('--chain-id', chainId);
    await runCapture(captureArgs);
    const report = JSON.parse(fs.readFileSync(path.join(slotDir, 'report.json'), 'utf8'));
    slots.push({ slot, directory: `slot-${slot}`, status: report.findings?.[0]?.status ?? 'UNKNOWN', ruleId: report.findings?.[0]?.ruleId ?? null });
  }

  fs.writeFileSync(path.join(out, 'batch-manifest.json'), `${JSON.stringify({
    schemaVersion: '0.1.0', network, megapoolAddress: megapool, executionBlockTag: block,
    expectedChainId: chainId === null ? null : Number(chainId), protocolVersion,
    validatorCount: count, capturedRange: { from, to }, capturedAt: new Date().toISOString(), slots
  }, null, 2)}\n`, 'utf8');
  console.log(`Batch capture complete: ${slots.length} slot bundle(s) in ${out}`);
}

main().catch(error => { console.error(`Fatal: ${error.message}`); process.exit(1); });
