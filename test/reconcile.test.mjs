import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reconcile, toMarkdown, toTerminal } from '../src/reconcile.mjs';
import { createMockRpcServer } from '../src/mock-server.mjs';
import { fetchCrossLayerSnapshot } from '../src/adapters.mjs';
import { encodeGetValidatorDetails, decodeValidatorDetails, MEGAPOOL_SIGNATURES } from '../src/megapool.mjs';
import { verifyWithdrawalCredentials, formatEpochProjection, extractWithdrawalAddress } from '../src/beacon.mjs';
import { encodeFunctionCall, splitWords, padUint256, decodeUint256 } from '../src/evm.mjs';

const loadFixture = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));

test('EVM ABI: encodeFunctionCall and decoding matches EVM specification', () => {
  const callData = encodeGetValidatorDetails(5);
  assert.ok(callData.startsWith('0x'));
  assert.equal(callData.length, 10 + 64); // 4-byte selector (8 hex + 0x) + 32-byte uint256 (64 hex)

  // Test tuple encoding and decoding
  const dummyResult = '0x' +
    padUint256(10044) +
    padUint256(3) + // exit_in_progress
    padUint256(1) + // exitNotified: true
    padUint256(0) + // balanceFinalized: false
    padUint256(0) + // dissolved: false
    padUint256(0) + // dissolutionEpoch: 0
    padUint256(1758500000); // lastDistributionTime

  const decoded = decodeValidatorDetails(dummyResult);
  assert.equal(decoded.beaconIndex, 10044);
  assert.equal(decoded.state, 'exit_in_progress');
  assert.equal(decoded.exitNotified, true);
  assert.equal(decoded.balanceFinalized, false);
  assert.equal(decoded.lastDistributionTime, 1758500000);
});

test('Beacon Math: credential verification detects mismatches and extracts execution address', () => {
  const megapoolAddr = '0x1111111111111111111111111111111111111111';
  const matchingCred = '0x0100000000000000000000001111111111111111111111111111111111111111';
  const mismatchCred = '0x0100000000000000000000009999999999999999999999999999999999999999';

  assert.equal(extractWithdrawalAddress(matchingCred), megapoolAddr);
  assert.equal(verifyWithdrawalCredentials(matchingCred, megapoolAddr).valid, true);

  const mismatchResult = verifyWithdrawalCredentials(mismatchCred, megapoolAddr);
  assert.equal(mismatchResult.valid, false);
  assert.ok(mismatchResult.reason.includes('Credential mismatch'));
});

test('Beacon Math: formatEpochProjection calculates elapsed and remaining duration', () => {
  const elapsed = formatEpochProjection(900, 950, 'holesky');
  assert.ok(elapsed.includes('Finalized / Elapsed'));

  const upcoming = formatEpochProjection(1000, 950, 'holesky');
  assert.ok(upcoming.includes('remaining'));
});

test('Rule RECON-000: healthy fixture yields HEALTHY with complete evidence', () => {
  const report = reconcile(loadFixture('healthy'));
  assert.equal(report.schemaVersion, '0.1.0');
  assert.equal(report.network, 'holesky');
  assert.equal(report.findings.length, 1);
  const [f] = report.findings;
  assert.equal(f.ruleId, 'RECON-000');
  assert.equal(f.status, 'HEALTHY');
  assert.equal(f.severity, 'info');
  assert.ok(f.explanation.includes('consistent'));
  assert.ok(f.limitation.length > 0);
  assert.ok(report.contractValues);
  assert.ok(report.beaconValues);
});

test('Rule RECON-CRED-001: withdrawal credentials mismatch triggers CRITICAL action required', () => {
  const report = reconcile(loadFixture('credential_mismatch'));
  const credFinding = report.findings.find(f => f.ruleId === 'RECON-CRED-001');
  assert.ok(credFinding);
  assert.equal(credFinding.status, 'ACTION_REQUIRED');
  assert.equal(credFinding.severity, 'critical');
  assert.ok(credFinding.explanation.includes('withdrawal credentials mismatch'));
});

test('Rule RECON-006: awaiting assignment fixture yields HEALTHY queued', () => {
  const report = reconcile(loadFixture('awaiting_assignment'));
  assert.equal(report.findings.length, 1);
  const [f] = report.findings;
  assert.equal(f.ruleId, 'RECON-006');
  assert.equal(f.status, 'HEALTHY');
  assert.equal(f.severity, 'info');
  assert.ok(f.explanation.includes('pending index assignment'));
});

test('Rule RECON-004: exit in progress fixture yields ACTION_SOON with projection', () => {
  const report = reconcile(loadFixture('exit_in_progress'));
  assert.equal(report.findings.length, 1);
  const [f] = report.findings;
  assert.equal(f.ruleId, 'RECON-004');
  assert.equal(f.status, 'ACTION_SOON');
  assert.equal(f.severity, 'medium');
  assert.ok(f.deadline.includes('Epoch 980'));
  assert.ok(f.risk.includes('inactivity leaks'));
});

test('Rule RECON-003: withdrawable fixture yields ACTION_REQUIRED with concrete action', () => {
  const report = reconcile(loadFixture('withdrawable'));
  assert.equal(report.findings.length, 1);
  const [f] = report.findings;
  assert.equal(f.ruleId, 'RECON-003');
  assert.equal(f.status, 'ACTION_REQUIRED');
  assert.equal(f.severity, 'high');
  assert.ok(f.operatorAction.includes('notify-validator-exit'));
  assert.ok(f.risk.includes('capital remains locked'));
});

test('Rule RECON-007: completed withdrawal fixture yields HEALTHY finalisation', () => {
  const report = reconcile(loadFixture('completed_withdrawal'));
  assert.equal(report.findings.length, 1);
  const [f] = report.findings;
  assert.equal(f.ruleId, 'RECON-007');
  assert.equal(f.status, 'HEALTHY');
  assert.equal(f.severity, 'info');
  assert.ok(f.explanation.includes('completed successfully'));
});

test('Rule RECON-005: dissolved fixture yields ACTION_REQUIRED with dissolution proof window', () => {
  const report = reconcile(loadFixture('dissolved'));
  assert.equal(report.findings.length, 1);
  const [f] = report.findings;
  assert.equal(f.ruleId, 'RECON-005');
  assert.equal(f.status, 'ACTION_REQUIRED');
  assert.equal(f.severity, 'high');
  assert.ok(f.explanation.includes('dissolved'));
});

test('Rule BEACON-001: unavailable beacon fixture yields INCONCLUSIVE never negative', () => {
  const report = reconcile(loadFixture('inconclusive'));
  assert.equal(report.findings.length, 1);
  const [f] = report.findings;
  assert.equal(f.ruleId, 'BEACON-001');
  assert.equal(f.status, 'INCONCLUSIVE');
  assert.equal(f.severity, 'medium');
  assert.ok(f.limitation.includes('Missing beacon data is never treated as a negative finding'));
});

test('Rule RECON-001: mismatched state fixture yields ACTION_REQUIRED for missing beacon validator', () => {
  const report = reconcile(loadFixture('mismatched_state'));
  assert.equal(report.findings.length, 1);
  const [f] = report.findings;
  assert.equal(f.ruleId, 'RECON-001');
  assert.equal(f.status, 'ACTION_REQUIRED');
  assert.equal(f.severity, 'high');
  assert.ok(f.explanation.includes('cannot locate the validator record'));
});

test('Rule VERSION-001: unsupported protocol version yields UNSUPPORTED_VERSION', () => {
  const report = reconcile(loadFixture('unsupported_version'));
  assert.equal(report.findings.length, 1);
  const [f] = report.findings;
  assert.equal(f.ruleId, 'VERSION-001');
  assert.equal(f.status, 'UNSUPPORTED_VERSION');
  assert.equal(f.severity, 'high');
});

test('Batch Megapool reconciliation reconciles multi-validator pools', () => {
  const report = reconcile(loadFixture('megapool_batch'));
  assert.equal(report.validatorCount, 3);
  assert.equal(report.overallStatus, 'ACTION_REQUIRED');
  assert.equal(report.validators.length, 3);
  const md = toMarkdown(report);
  assert.ok(md.includes('Rocket Pool Megapool Audit Report (Megapool Batch)'));
  assert.ok(md.includes('Total Validators Reconciled'));

  const term = toTerminal(report);
  assert.ok(term.includes('Total Validators: 3'));
});

test('Integration: Mock RPC server with EVM calldata enables full cross-layer reconciliation', async () => {
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

  try {
    const baseUrl = await mock.listen();
    const snapshot = await fetchCrossLayerSnapshot({
      megapoolAddress: '0x1111111111111111111111111111111111111111',
      elRpcUrl: baseUrl,
      clRpcUrl: baseUrl,
      validatorId: 'v-mock-test',
      network: 'holesky',
      protocolVersion: 'saturn-1'
    });

    assert.equal(snapshot.metadata.executionBlock, 2500000);
    assert.equal(snapshot.contract.beaconIndex, 10044);
    assert.equal(snapshot.beacon.finalizedEpoch, 950);
    assert.equal(snapshot.beacon.status, 'withdrawal_possible');

    const report = reconcile(snapshot);
    assert.equal(report.findings[0].ruleId, 'RECON-003');
    assert.equal(report.findings[0].status, 'ACTION_REQUIRED');
  } finally {
    await mock.close();
  }
});
