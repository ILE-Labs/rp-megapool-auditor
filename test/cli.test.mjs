import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve('src/cli.mjs');

test('CLI runs with --fixture and produces JSON output', async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, '--fixture', 'fixtures/withdrawable.json', '--format', 'json']);
  const json = JSON.parse(stdout);
  assert.equal(json.network, 'holesky');
  assert.equal(json.findings[0].ruleId, 'RECON-003');
  assert.equal(json.findings[0].status, 'ACTION_REQUIRED');
});

test('CLI runs with --fixture and produces Markdown output', async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, '--fixture', 'fixtures/healthy.json', '--format', 'markdown']);
  assert.ok(stdout.includes('# Rocket Pool Megapool Audit Report'));
  assert.ok(stdout.includes('`RECON-000`'));
  assert.ok(stdout.includes('`HEALTHY`'));
});

test('CLI runs with --fixture and produces Terminal output', async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, '--fixture', 'fixtures/inconclusive.json', '--format', 'terminal']);
  assert.ok(stdout.includes('ROCKET POOL MEGAPOOL CROSS-LAYER AUDIT REPORT'));
  assert.ok(stdout.includes('BEACON-001'));
  assert.ok(stdout.includes('INCONCLUSIVE'));
});

test('CLI shows help on --help', async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, '--help']);
  assert.ok(stdout.includes('USAGE:'));
  assert.ok(stdout.includes('--fixture'));
  assert.ok(stdout.includes('--megapool'));
});
