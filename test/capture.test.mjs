import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { reconcile, toMarkdown } from '../src/reconcile.mjs';
import { createMockRpcServer } from '../src/mock-server.mjs';
import { padUint256 } from '../src/evm.mjs';

const execFileAsync = promisify(execFile);

/**
 * Tests that exercise the entire capture → replay → compare pipeline
 * using a local mock RPC server. No network access required.
 */

test('capture.mjs: writes a complete capture bundle with correct file set', async () => {
  const mock = createMockRpcServer({
    executionBlockHex: '0x2625a0',
    megapoolValidatorState: {
      beaconIndex: 10044,
      stateCode: 3,        // exit_in_progress
      exitNotified: false,
      balanceFinalized: false,
      dissolved: false,
      dissolutionEpoch: 0,
      lastDistributionTime: 1758500000
    },
    finalizedSlot: '30400', // epoch 950
    beaconValidator: {
      index: '10044',
      status: 'withdrawal_possible',
      validator: {
        pubkey: '0x888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888',
        withdrawal_credentials: '0x0100000000000000000000001111111111111111111111111111111111111111',
        activation_epoch: '800',
        exit_epoch: '920',
        withdrawable_epoch: '945'
      }
    }
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-capture-test-'));

  try {
    const baseUrl = await mock.listen();

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      'src/capture.mjs',
      '--megapool', '0x1111111111111111111111111111111111111111',
      '--el-rpc', baseUrl,
      '--cl-rpc', baseUrl,
      '--network', 'holesky',
      '--out', outDir
    ]);

    // Verify all expected files were written
    const expectedFiles = [
      'capture-metadata.json',
      'el-block-number.json',
      'el-validator-count.json',
      'el-validator-0.json',
      'cl-finalized-header.json',
      'cl-validator-10044.json',
      'snapshot.json',
      'report.json',
      'report.md',
      'report.terminal.txt'
    ];
    for (const f of expectedFiles) {
      const exists = fs.existsSync(path.join(outDir, f));
      assert.ok(exists, `Expected capture file missing: ${f}`);
    }

    // Verify metadata
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'capture-metadata.json'), 'utf8'));
    assert.equal(meta.network, 'holesky');
    assert.equal(meta.megapoolAddress, '0x1111111111111111111111111111111111111111');
    assert.equal(meta.executionBlock, 2500000);
    assert.equal(meta.finalizedEpoch, 950);
    assert.equal(meta.overallStatus, 'ACTION_REQUIRED');
    assert.equal(meta.ruleId, 'RECON-003');

    // Verify the report JSON
    const report = JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8'));
    assert.equal(report.findings[0].ruleId, 'RECON-003');
    assert.equal(report.findings[0].status, 'ACTION_REQUIRED');

    // Verify the raw EL block response was saved
    const blockRaw = JSON.parse(fs.readFileSync(path.join(outDir, 'el-block-number.json'), 'utf8'));
    assert.ok(blockRaw.timestamp);
    assert.ok(blockRaw.elapsedMs >= 0);
    assert.equal(blockRaw.status, 200);

    // Verify the raw CL header response was saved
    const headerRaw = JSON.parse(fs.readFileSync(path.join(outDir, 'cl-finalized-header.json'), 'utf8'));
    assert.ok(headerRaw.body.includes('30400'));

    // Verify the snapshot is self-contained
    const snapshot = JSON.parse(fs.readFileSync(path.join(outDir, 'snapshot.json'), 'utf8'));
    assert.equal(snapshot.metadata.executionBlock, 2500000);
    assert.equal(snapshot.contract.state, 'exit_in_progress');
    assert.equal(snapshot.beacon.status, 'withdrawal_possible');
    assert.equal(snapshot.beacon.withdrawableEpoch, 945);

  } finally {
    await mock.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('replay.mjs: reruns reconciler against saved snapshot deterministically', async () => {
  const mock = createMockRpcServer({
    executionBlockHex: '0x2625a0',
    megapoolValidatorState: {
      beaconIndex: 10044,
      stateCode: 3,
      exitNotified: false,
      balanceFinalized: false,
      dissolved: false,
      dissolutionEpoch: 0,
      lastDistributionTime: 1758500000
    },
    finalizedSlot: '30400',
    beaconValidator: {
      index: '10044',
      status: 'withdrawal_possible',
      validator: {
        pubkey: '0x888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888',
        withdrawal_credentials: '0x0100000000000000000000001111111111111111111111111111111111111111',
        activation_epoch: '800',
        exit_epoch: '920',
        withdrawable_epoch: '945'
      }
    }
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-replay-test-'));

  try {
    const baseUrl = await mock.listen();

    // Run capture first
    await execFileAsync(process.execPath, [
      'src/capture.mjs',
      '--megapool', '0x1111111111111111111111111111111111111111',
      '--el-rpc', baseUrl,
      '--cl-rpc', baseUrl,
      '--network', 'holesky',
      '--out', outDir
    ]);

    // Now close mock so replay cannot use the network
    await mock.close();

    // Run replay — must work without any network calls
    const { stdout } = await execFileAsync(process.execPath, [
      'src/replay.mjs',
      '--capture', outDir,
      '--format', 'json'
    ]);

    const replayed = JSON.parse(stdout);
    assert.equal(replayed.findings[0].ruleId, 'RECON-003');
    assert.equal(replayed.findings[0].status, 'ACTION_REQUIRED');

    // Timestamps should be pinned to the original capture time, not now
    const snapshot = JSON.parse(fs.readFileSync(path.join(outDir, 'snapshot.json'), 'utf8'));
    assert.equal(replayed.generatedAt, snapshot.metadata.capturedAt);

  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('compare.mjs: generates comparison document from capture bundle', async () => {
  const mock = createMockRpcServer({
    executionBlockHex: '0x2625a0',
    megapoolValidatorState: {
      beaconIndex: 10044,
      stateCode: 3,
      exitNotified: false,
      balanceFinalized: false,
      dissolved: false,
      dissolutionEpoch: 0,
      lastDistributionTime: 1758500000
    },
    finalizedSlot: '30400',
    beaconValidator: {
      index: '10044',
      status: 'withdrawal_possible',
      validator: {
        pubkey: '0x888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888',
        withdrawal_credentials: '0x0100000000000000000000001111111111111111111111111111111111111111',
        activation_epoch: '800',
        exit_epoch: '920',
        withdrawable_epoch: '945'
      }
    }
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-compare-test-'));

  try {
    const baseUrl = await mock.listen();

    await execFileAsync(process.execPath, [
      'src/capture.mjs',
      '--megapool', '0x1111111111111111111111111111111111111111',
      '--el-rpc', baseUrl,
      '--cl-rpc', baseUrl,
      '--network', 'holesky',
      '--out', outDir
    ]);
    await mock.close();

    // Write a synthetic smartnode output file
    const smartnodeText = [
      'Megapool Status',
      '  State:            Exit In Progress',
      '  Exit Notified:    false',
      '  Balance Finalized: false',
      '  Beacon Index:     10044',
      '  Node Address:     0xabcdef'
    ].join('\n');
    const smFile = path.join(outDir, 'smartnode-status.txt');
    fs.writeFileSync(smFile, smartnodeText, 'utf8');

    const compFile = path.join(outDir, 'comparison.md');
    await execFileAsync(process.execPath, [
      'src/compare.mjs',
      '--capture', outDir,
      '--smartnode', smFile,
      '--out', compFile
    ]);

    assert.ok(fs.existsSync(compFile));
    const md = fs.readFileSync(compFile, 'utf8');
    assert.ok(md.includes('Cross-Layer Tooling Comparison'));
    assert.ok(md.includes('RECON-003'));
    assert.ok(md.includes('ACTION_REQUIRED'));
    assert.ok(md.includes('Exit In Progress'));
    assert.ok(md.includes('withdrawal_possible'));
    assert.ok(md.includes('joined the execution and beacon states'));

  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('capture.mjs: INCONCLUSIVE when beacon endpoint is down', async () => {
  const mock = createMockRpcServer({
    executionBlockHex: '0x2625a0',
    megapoolValidatorState: {
      beaconIndex: 10044,
      stateCode: 2,
      exitNotified: false,
      balanceFinalized: false,
      dissolved: false,
      dissolutionEpoch: 0,
      lastDistributionTime: 0
    },
    beaconUnavailable: true
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-inconclusive-test-'));

  try {
    const baseUrl = await mock.listen();

    await execFileAsync(process.execPath, [
      'src/capture.mjs',
      '--megapool', '0x1111111111111111111111111111111111111111',
      '--el-rpc', baseUrl,
      '--cl-rpc', baseUrl,
      '--network', 'holesky',
      '--out', outDir
    ]);

    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'capture-metadata.json'), 'utf8'));
    assert.equal(meta.overallStatus, 'INCONCLUSIVE');
    assert.equal(meta.ruleId, 'BEACON-001');

  } finally {
    await mock.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
