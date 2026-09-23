import { formatEpochProjection, verifyWithdrawalCredentials, estimateEpochTimestamp } from './beacon.mjs';

const STATUSES = new Set([
  'ACTION_REQUIRED', 'ACTION_SOON', 'HEALTHY', 'INCONCLUSIVE', 'UNSUPPORTED_VERSION'
]);

function finding({
  ruleId,
  status,
  severity,
  explanation,
  operatorAction = null,
  deadline = null,
  risk = null,
  limitation,
  evidence
}) {
  if (!STATUSES.has(status)) {
    throw new Error(`invalid status: ${status}`);
  }
  return {
    ruleId,
    status,
    severity,
    explanation,
    operatorAction,
    deadline,
    risk,
    limitation,
    evidence
  };
}

export function reconcileValidator(input) {
  const { contract = {}, beacon = null, metadata = {} } = input;
  const network = metadata.network ?? 'holesky';

  const executionExplorerBase = metadata.explorerBaseUrl ? metadata.explorerBaseUrl.replace(/\/+$/, '') : null;
  const beaconExplorerBase = (metadata.clExplorerBaseUrl || metadata.explorerBaseUrl)
    ? (metadata.clExplorerBaseUrl || metadata.explorerBaseUrl).replace(/\/+$/, '')
    : null;

  const urls = {
    megapoolUrl: (executionExplorerBase && metadata.megapoolAddress)
      ? `${executionExplorerBase}/address/${metadata.megapoolAddress}`
      : null,
    executionBlockUrl: (executionExplorerBase && metadata.executionBlock)
      ? `${executionExplorerBase}/block/${metadata.executionBlock}`
      : null,
    validatorBeaconUrl: (beaconExplorerBase && (contract.beaconIndex !== undefined && contract.beaconIndex !== null))
      ? `${beaconExplorerBase}/validator/${contract.beaconIndex}`
      : null
  };

  const contractValues = {
    validatorId: contract.validatorId ?? metadata.validatorId ?? null,
    beaconIndex: contract.beaconIndex ?? null,
    pubkey: contract.pubkey ?? null,
    state: contract.state ?? null,
    exitNotified: contract.exitNotified === undefined ? false : contract.exitNotified,
    dissolved: contract.dissolved === undefined ? (contract.state === 'dissolved') : contract.dissolved,
    dissolutionEpoch: contract.dissolutionEpoch ?? null,
    balanceFinalized: contract.balanceFinalized === undefined ? false : contract.balanceFinalized,
    lastDistributionTime: contract.lastDistributionTime ?? null
  };

  const beaconValues = beacon ? {
    validatorIndex: beacon.validatorIndex ?? contract.beaconIndex ?? null,
    pubkey: beacon.pubkey ?? contract.pubkey ?? null,
    status: beacon.status ?? null,
    slashed: beacon.slashed ?? (typeof beacon.status === 'string' && beacon.status.includes('slashed')),
    activationEpoch: beacon.activationEpoch ?? null,
    exitEpoch: beacon.exitEpoch ?? null,
    withdrawableEpoch: beacon.withdrawableEpoch ?? null,
    withdrawalCredentials: beacon.withdrawalCredentials ?? null,
    finalizedEpoch: beacon.finalizedEpoch ?? null,
    withdrawn: beacon.withdrawn ?? (beacon.status === 'withdrawal_done' || beacon.status === 'exited_withdrawn')
  } : null;

  const base = {
    network,
    megapoolAddress: metadata.megapoolAddress ?? null,
    validatorId: contractValues.validatorId,
    beaconIndex: contractValues.beaconIndex,
    executionBlock: metadata.executionBlock ?? null,
    finalizedEpoch: beaconValues?.finalizedEpoch ?? metadata.finalizedEpoch ?? null,
    urls,
    contractValues,
    beaconValues
  };

  const findings = [];
  const SUPPORTED_VERSIONS = new Set(['saturn-1']);

  if (metadata.deployment && !metadata.deployment.valid) {
    findings.push(finding({
      ruleId: 'DEPLOYMENT-001',
      status: 'INCONCLUSIVE',
      severity: 'high',
      explanation: 'The supplied Megapool address could not be verified as deployed on the queried execution chain, or the observed chain ID did not match the requested chain ID.',
      operatorAction: 'Verify the network, Megapool address, execution RPC, and expected chain ID before relying on the audit.',
      deadline: 'Before taking any operator action from this report.',
      risk: 'Auditing the wrong address or chain can produce an apparently valid but irrelevant result.',
      limitation: 'Bytecode presence proves deployment only; it does not prove that the address is the intended Rocket Pool Saturn 1 Megapool.',
      evidence: { deployment: metadata.deployment }
    }));
    return { schemaVersion: '0.1.0', generatedAt: metadata.generatedAt ?? new Date().toISOString(), ...base, findings };
  }

  // 1. Version Check
  if (!metadata.protocolVersion || !SUPPORTED_VERSIONS.has(metadata.protocolVersion)) {
    findings.push(finding({
      ruleId: 'VERSION-001',
      status: 'UNSUPPORTED_VERSION',
      severity: 'high',
      explanation: `The protocol version '${metadata.protocolVersion ?? 'missing'}' is not supported by this auditor ruleset (supported: saturn-1).`,
      operatorAction: 'Upgrade rp-megapool-auditor or verify target network contract deployment version.',
      deadline: 'Prior to evaluating validator operational decisions.',
      risk: 'Auditor contract assumptions may mismatch on-chain state layout or function selectors.',
      limitation: 'No protocol-specific conclusion is safe until the interface is pinned.',
      evidence: { metadata }
    }));
    return { schemaVersion: '0.1.0', generatedAt: metadata.generatedAt ?? new Date().toISOString(), ...base, findings };
  }

  // 2. Beacon Availability Check
  if (beacon === null) {
    findings.push(finding({
      ruleId: 'BEACON-001',
      status: 'INCONCLUSIVE',
      severity: 'medium',
      explanation: 'Beacon-chain data was unavailable or unqueryable for this validator snapshot.',
      operatorAction: 'Verify consensus client REST connectivity and sync status; re-run query once finalized epoch data is reachable.',
      deadline: 'None immediate; dependent on consensus node RPC restore.',
      risk: 'Cross-layer reconciliation cannot establish whether validator is active, slashed, exiting, or withdrawable.',
      limitation: 'Missing beacon data is never treated as a negative finding or protocol failure.',
      evidence: { contract, metadata }
    }));
    return { schemaVersion: '0.1.0', generatedAt: metadata.generatedAt ?? new Date().toISOString(), ...base, findings };
  }

  // 3. Execution State Availability Check
  if (!contract.state || contract.state === 'unknown') {
    findings.push(finding({
      ruleId: 'EXECUTION-001',
      status: 'INCONCLUSIVE',
      severity: 'high',
      explanation: 'Execution-layer megapool state could not be decoded reliably for this snapshot.',
      operatorAction: 'Verify the contract address, protocol-version pin, ABI selectors, and execution RPC response before acting.',
      deadline: 'None until the execution snapshot is valid.',
      risk: 'Treating an undecoded contract response as active or healthy could produce an unsafe operator recommendation.',
      limitation: 'No cross-layer conclusion is emitted when the execution-side state is unknown.',
      evidence: { contract, metadata }
    }));
    return { schemaVersion: '0.1.0', generatedAt: metadata.generatedAt ?? new Date().toISOString(), ...base, findings };
  }

  // 4. Withdrawal Credentials Verification
  if (beaconValues.withdrawalCredentials && metadata.megapoolAddress) {
    const credCheck = verifyWithdrawalCredentials(beaconValues.withdrawalCredentials, metadata.megapoolAddress);
    if (!credCheck.valid) {
      findings.push(finding({
        ruleId: 'RECON-CRED-001',
        status: 'ACTION_REQUIRED',
        severity: 'critical',
        explanation: `CRITICAL: Beacon withdrawal credentials mismatch. ${credCheck.reason}. Skimmed or exit funds will not sweep into this Megapool vault!`,
        operatorAction: 'Immediately inspect validator deposit history, key generation logs, and withdrawal address configuration.',
        deadline: 'Immediate; before validator exit or periodic balance skimming occurs.',
        risk: 'Direct loss of rewards and principal to incorrect execution address upon consensus sweep.',
        limitation: 'Beacon credentials cannot be changed on-chain once set to type 0x01.',
        evidence: { withdrawalCredentials: beaconValues.withdrawalCredentials, expectedMegapool: metadata.megapoolAddress }
      }));
    }
  }

  // 4. Slashing Detection
  if (beaconValues.slashed) {
    findings.push(finding({
      ruleId: 'RECON-SLASH-001',
      status: 'ACTION_REQUIRED',
      severity: 'critical',
      explanation: 'The validator is slashed on the consensus layer. Protocol penalties and balance reductions are in effect.',
      operatorAction: 'Stop duplicate validator instances immediately; review megapool collateral deficit and dissolution procedures.',
      deadline: 'Immediate.',
      risk: 'Severe capital slash and forced consensus exit.',
      limitation: 'Tool does not calculate exact penalty percentage or protocol slash proofs.',
      evidence: { contract, beacon }
    }));
  }

  // 5. Queued / Pending Assignment
  if (contract.state === 'pending_assignment' || (contract.state === 'queued' && contract.beaconIndex === null)) {
    findings.push(finding({
      ruleId: 'RECON-006',
      status: 'HEALTHY',
      severity: 'info',
      explanation: 'Validator is queued / pending index assignment on the execution layer awaiting beacon deposit processing.',
      operatorAction: 'No immediate action required; monitor beacon chain for deposit inclusion and activation queue entry.',
      deadline: 'Typical deposit queue latency (~16-24 hours).',
      risk: 'Low; normal protocol onboarding lifecycle.',
      limitation: 'Beacon index is not yet known on execution layer; cross-layer correlation is unlinked until deposit receipt.',
      evidence: { contract, beacon }
    }));
  }
  // 6. Execution Active, Beacon Absent (Missing Beacon Registration)
  else if (contract.state === 'active' && (beacon.status === 'not_found' || beacon.status === 'absent')) {
    findings.push(finding({
      ruleId: 'RECON-001',
      status: 'ACTION_REQUIRED',
      severity: 'high',
      explanation: 'The execution-layer contract records the validator as active with an assigned index, but the beacon node cannot locate the validator record.',
      operatorAction: 'Verify validator pubkey, check beacon node sync state, and confirm if index assignment was reorged or corrupted.',
      deadline: 'Immediate investigation required before submitting further megapool deposits or state updates.',
      risk: 'Potential deposit loss, incorrect validator registration, or severe consensus client desynchronization.',
      limitation: 'Check index assignment, beacon endpoint freshness, and the pinned execution block before taking destructive steps.',
      evidence: { contract, beacon }
    }));
  }
  // 7. Contract Exit State without Beacon Exit (Gossip / Propagation Lag)
  else if (contract.state === 'exit_in_progress' && (beacon.status === 'active' || beacon.status === 'active_ongoing') && beacon.exitEpoch === null) {
    findings.push(finding({
      ruleId: 'RECON-002',
      status: 'INCONCLUSIVE',
      severity: 'high',
      explanation: 'The contract records an exit-related state, but the beacon record is still active with no scheduled exit epoch.',
      operatorAction: 'Verify voluntary exit message broadcast on consensus layer and confirm whether exit gossip propagated.',
      deadline: 'Review before expected exit queue horizon.',
      risk: 'Validator continues to attest and incur penalties if validator node is shut down prematurely.',
      limitation: 'This may be an indexing lag or consensus broadcast delay; it is not proof of protocol failure.',
      evidence: { contract, beacon }
    }));
  }
  // 8. Withdrawable reached but contract exit notification missing
  else if ((beacon.status === 'withdrawal_possible' || beacon.status === 'withdrawable') && contract.exitNotified === false) {
    const currentEpoch = beacon.finalizedEpoch ?? 0;
    const withdrawableEpoch = beacon.withdrawableEpoch ?? currentEpoch;
    const projection = formatEpochProjection(withdrawableEpoch, currentEpoch, network);
    findings.push(finding({
      ruleId: 'RECON-003',
      status: 'ACTION_REQUIRED',
      severity: 'high',
      explanation: `The beacon validator is withdrawable (${projection}), but the contract-side exit notification ('notifyValidatorExit') is not reflected.`,
      operatorAction: `Execute Rocket Pool contract exit notification: 'rocketpool megapool notify-validator-exit --validator-id ${contract.validatorId || '<id>'}' or notify via execution contract.`,
      deadline: `Overdue (Withdrawable at Epoch ${withdrawableEpoch}, Current Finalized Epoch ${currentEpoch}).`,
      risk: 'Megapool node operator capital remains locked in consensus withdrawal pipeline without triggering execution accounting or ETH distribution.',
      limitation: 'The tool reports a condition to inspect; it does not submit a notification or transaction.',
      evidence: { contract, beacon }
    }));
  }
  // The current Saturn ABI does not expose the legacy exit-notification flag.
  else if ((beacon.status === 'withdrawal_possible' || beacon.status === 'withdrawable') && contract.exitNotified === null) {
    findings.push(finding({
      ruleId: 'RECON-003',
      status: 'INCONCLUSIVE',
      severity: 'medium',
      explanation: 'The Beacon validator is withdrawable, but the current Megapool read-only ABI does not expose enough execution-side notification state to determine whether the required accounting step was recorded.',
      operatorAction: 'Inspect the current Rocket Pool Smartnode/protocol status before taking action; do not submit a transaction based on this report alone.',
      deadline: 'Review before relying on the final-balance workflow.',
      risk: 'A notification state could be missed if a consumer assumes the current ABI contains the legacy field.',
      limitation: 'This is an ABI coverage gap, not evidence that the protocol is missing the notification.',
      evidence: { contract, beacon }
    }));
  }
  // 9. Exiting with future withdrawable epoch
  else if (beacon.status === 'exiting' && beacon.withdrawableEpoch !== null) {
    const currentEpoch = beacon.finalizedEpoch ?? 0;
    const withdrawableEpoch = beacon.withdrawableEpoch;
    const projection = formatEpochProjection(withdrawableEpoch, currentEpoch, network);
    findings.push(finding({
      ruleId: 'RECON-004',
      status: 'ACTION_SOON',
      severity: 'medium',
      explanation: `Validator is exiting on the beacon chain with withdrawable target: ${projection}.`,
      operatorAction: 'Prepare for execution-layer notification once withdrawable epoch is reached.',
      deadline: projection,
      risk: 'Validator must maintain validator keys active until exit epoch completes to avoid inactivity leaks.',
      limitation: 'The report does not calculate gas, final balance, or the exact protocol action deadline.',
      evidence: { contract, beacon }
    }));
  }
  // 10. Withdrawal done on Beacon, balance unfinalized on contract
  else if ((beacon.status === 'withdrawal_done' || beacon.status === 'exited_withdrawn' || beacon.withdrawn) && contract.balanceFinalized === false && contract.state !== 'dissolved') {
    findings.push(finding({
      ruleId: 'RECON-008',
      status: 'ACTION_REQUIRED',
      severity: 'high',
      explanation: 'Consensus layer withdrawal has fully completed and funds swept to execution address, but the megapool contract balance is not finalized.',
      operatorAction: `Trigger final balance notification: 'rocketpool megapool notify-final-balance --validator-id ${contract.validatorId || '<id>'}' and claim distribution.`,
      deadline: 'Final balance accounting window.',
      risk: 'Staked node operator rewards and excess principal remain undistributed within the megapool vault.',
      limitation: 'Contract distribution rules depend on megapool fee configuration and penalty proofs.',
      evidence: { contract, beacon }
    }));
  }
  // The current ValidatorInfo ABI has no balanceFinalized member. A null value
  // must remain inconclusive rather than being coerced into a failure.
  else if ((beacon.status === 'withdrawal_done' || beacon.status === 'exited_withdrawn' || beacon.withdrawn) && contract.balanceFinalized === null && contract.state !== 'dissolved') {
    findings.push(finding({
      ruleId: 'RECON-008',
      status: 'INCONCLUSIVE',
      severity: 'medium',
      explanation: 'The Beacon withdrawal is complete and the execution record is exited, but the current Megapool ValidatorInfo ABI does not expose a final-balance flag.',
      operatorAction: 'Use the current Smartnode megapool status/validator command or an explicitly supported contract getter to verify final-balance accounting.',
      deadline: 'Review before claiming the accounting lifecycle is complete.',
      risk: 'The auditor cannot distinguish completed final-balance accounting from an outstanding accounting step using this ABI alone.',
      limitation: 'No action-required conclusion is emitted without a current execution-side field proving the missing step.',
      evidence: { contract, beacon }
    }));
  }
  // 11. Dissolved Validator State
  else if (contract.state === 'dissolved' || contract.dissolved) {
    const epochInfo = contract.dissolutionEpoch ? ` (dissolution epoch: ${contract.dissolutionEpoch})` : '';
    findings.push(finding({
      ruleId: 'RECON-005',
      status: 'ACTION_REQUIRED',
      severity: 'high',
      explanation: `The validator is marked dissolved on the megapool contract${epochInfo}. Final balance resolution or proof submission is pending.`,
      operatorAction: 'Inspect megapool contract dissolution logs and execute final dissolution settlement / distribution steps.',
      deadline: 'Dissolution proof / penalty submission window.',
      risk: 'Unresolved dissolved state prevents megapool vault collateral rebalancing or operator stake reclamation.',
      limitation: 'No transaction is constructed or broadcast by this tool.',
      evidence: { contract, beacon }
    }));
  }
  // 12. Completed & Settled
  else if ((contract.state === 'withdrawn' || contract.state === 'finalized') && (contract.balanceFinalized || contract.exitNotified)) {
    findings.push(finding({
      ruleId: 'RECON-007',
      status: 'HEALTHY',
      severity: 'info',
      explanation: 'Validator withdrawal and contract state settlement have completed successfully.',
      operatorAction: 'No operator action required. Validator lifecycle is completed.',
      deadline: null,
      risk: 'None.',
      limitation: 'Historical settlement confirmation; does not reflect subsequent new validator deposits.',
      evidence: { contract, beacon }
    }));
  }
  // 13. Baseline Healthy
  else if (findings.length === 0) {
    findings.push(finding({
      ruleId: 'RECON-000',
      status: 'HEALTHY',
      severity: 'info',
      explanation: 'The supplied execution and beacon records are consistent; validator is actively attesting on the beacon chain.',
      operatorAction: 'No operator action required. Continue normal validator performance monitoring.',
      deadline: null,
      risk: 'None detected under current snapshot.',
      limitation: 'Healthy means no rule fired for this snapshot; it is not a guarantee of future validator performance or uptime.',
      evidence: { contract, beacon }
    }));
  }

  return {
    schemaVersion: '0.1.0',
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
    ...base,
    findings
  };
}

export function reconcile(input) {
  // Support single validator input or batch megapool input
  if (Array.isArray(input.validators)) {
    const reports = input.validators.map(v => reconcileValidator({
      metadata: input.metadata,
      contract: v.contract,
      beacon: v.beacon
    }));
    const allFindings = reports.flatMap(r => r.findings);
    const overallStatus = allFindings.some(f => f.status === 'ACTION_REQUIRED') ? 'ACTION_REQUIRED'
      : allFindings.some(f => f.status === 'ACTION_SOON') ? 'ACTION_SOON'
      : allFindings.some(f => f.status === 'INCONCLUSIVE') ? 'INCONCLUSIVE'
      : allFindings.some(f => f.status === 'UNSUPPORTED_VERSION') ? 'UNSUPPORTED_VERSION'
      : 'HEALTHY';

    return {
      schemaVersion: '0.1.0',
      generatedAt: input.metadata?.generatedAt ?? new Date().toISOString(),
      network: input.metadata?.network ?? 'holesky',
      megapoolAddress: input.metadata?.megapoolAddress ?? null,
      executionBlock: input.metadata?.executionBlock ?? null,
      finalizedEpoch: input.metadata?.finalizedEpoch ?? null,
      overallStatus,
      validatorCount: reports.length,
      validators: reports,
      findings: allFindings
    };
  }

  return reconcileValidator(input);
}

export function toMarkdown(report) {
  if (Array.isArray(report.validators)) {
    const rows = report.findings.map(f =>
      `| \`${f.ruleId}\` | \`${f.status}\` | **${f.severity}** | ${f.explanation} |`
    ).join('\n');

    return `# Rocket Pool Megapool Audit Report (Megapool Batch)

## Summary

- **Overall Status:** \`${report.overallStatus}\`
- **Network:** \`${report.network}\`
- **Megapool Address:** \`${report.megapoolAddress}\`
- **Total Validators Reconciled:** ${report.validatorCount}
- **Execution Block:** \`${report.executionBlock ?? 'N/A'}\`
- **Finalized Epoch:** \`${report.finalizedEpoch ?? 'N/A'}\`
- **Generated At:** \`${report.generatedAt}\`

## All Findings (${report.findings.length})

| Rule ID | Status | Severity | Finding |
|---|---|---|---|
${rows}

## Validator Breakdown

${report.validators.map((v, i) => `### Validator #${i + 1}: \`${v.validatorId}\` (Index: \`${v.beaconIndex ?? 'unassigned'}\`)
- **Status:** \`${v.findings[0]?.status}\`
- **Rule:** \`${v.findings[0]?.ruleId}\`
- **Action:** ${v.findings[0]?.operatorAction ?? 'None'}
- **Deadline:** ${v.findings[0]?.deadline ?? 'N/A'}
- **Risk:** ${v.findings[0]?.risk ?? 'N/A'}
`).join('\n')}

---
*Read-only report generated by rp-megapool-auditor.*
`;
  }

  const primaryFinding = report.findings[0] || {};
  const requiresAction = primaryFinding.status === 'ACTION_REQUIRED' ? '⚠️ YES' :
    primaryFinding.status === 'ACTION_SOON' ? '⏳ SOON' : '✅ NO';

  const rows = report.findings.map(f =>
    `| \`${f.ruleId}\` | \`${f.status}\` | **${f.severity}** | ${f.explanation} |`
  ).join('\n');

  const actions = report.findings.filter(f => f.operatorAction).map(f =>
    `- **${f.ruleId} Action:** ${f.operatorAction}\n  - **Deadline:** ${f.deadline ?? 'N/A'}\n  - **Risk:** ${f.risk ?? 'N/A'}`
  ).join('\n');

  const urls = [];
  if (report.urls?.megapoolUrl) urls.push(`- **Megapool Explorer:** [${report.megapoolAddress}](${report.urls.megapoolUrl})`);
  if (report.urls?.executionBlockUrl) urls.push(`- **Execution Block:** [${report.executionBlock}](${report.urls.executionBlockUrl})`);
  if (report.urls?.validatorBeaconUrl) urls.push(`- **Consensus Validator:** [Index ${report.beaconIndex}](${report.urls.validatorBeaconUrl})`);

  return `# Rocket Pool Megapool Audit Report

## Summary

- **Operator Action Required:** ${requiresAction}
- **Status:** \`${primaryFinding.status ?? 'UNKNOWN'}\`
- **Network:** \`${report.network}\`
- **Megapool Address:** \`${report.megapoolAddress ?? 'N/A'}\`
- **Validator ID:** \`${report.validatorId ?? 'N/A'}\`
- **Beacon Index:** \`${report.beaconIndex ?? 'unassigned'}\`
- **Execution Block:** \`${report.executionBlock ?? 'N/A'}\`
- **Finalized Epoch:** \`${report.finalizedEpoch ?? 'N/A'}\`
- **Generated At:** \`${report.generatedAt}\`

${urls.length > 0 ? `## Explorer Links\n\n${urls.join('\n')}\n` : ''}
## Cross-Layer Findings

| Rule ID | Status | Severity | Finding |
|---|---|---|---|
${rows}

${actions.length > 0 ? `## Recommended Operator Actions\n\n${actions}\n` : ''}
## Evidence Collected

### Execution-Layer State
\`\`\`json
${JSON.stringify(report.contractValues, null, 2)}
\`\`\`

### Beacon-Chain State
\`\`\`json
${JSON.stringify(report.beaconValues, null, 2)}
\`\`\`

## Limitations

${report.findings.map(f => `- **${f.ruleId}:** ${f.limitation}`).join('\n')}

---
*Read-only report generated by rp-megapool-auditor. No private keys handled; no transactions broadcast.*
`;
}

export function toTerminal(report) {
  const statusColor = (status) => {
    switch (status) {
      case 'ACTION_REQUIRED': return '\x1b[31;1m[ACTION_REQUIRED]\x1b[0m';
      case 'ACTION_SOON': return '\x1b[33;1m[ACTION_SOON]\x1b[0m';
      case 'HEALTHY': return '\x1b[32;1m[HEALTHY]\x1b[0m';
      case 'INCONCLUSIVE': return '\x1b[35;1m[INCONCLUSIVE]\x1b[0m';
      case 'UNSUPPORTED_VERSION': return '\x1b[31m[UNSUPPORTED_VERSION]\x1b[0m';
      default: return `[${status}]`;
    }
  };

  const lines = [
    '================================================================================',
    '                 ROCKET POOL MEGAPOOL CROSS-LAYER AUDIT REPORT                  ',
    '================================================================================',
    `Network:         ${report.network}`,
    `Megapool:        ${report.megapoolAddress ?? 'N/A'}`,
    `Execution Block: ${report.executionBlock ?? 'N/A'}`,
    `Finalized Epoch: ${report.finalizedEpoch ?? 'N/A'}`,
    `Generated At:    ${report.generatedAt}`,
    '--------------------------------------------------------------------------------'
  ];

  if (Array.isArray(report.validators)) {
    lines.push(`Overall Status:   ${statusColor(report.overallStatus)}`);
    lines.push(`Total Validators: ${report.validatorCount}`);
    lines.push('--------------------------------------------------------------------------------');
    lines.push('VALIDATOR FINDINGS:');
    for (const v of report.validators) {
      lines.push(`\n  • Validator ${v.validatorId} (Beacon Index: ${v.beaconIndex ?? 'unassigned'})`);
      for (const f of v.findings) {
        lines.push(`    ${statusColor(f.status)} ${f.ruleId} (${f.severity.toUpperCase()})`);
        lines.push(`      Finding:  ${f.explanation}`);
        if (f.operatorAction) {
          lines.push(`      Action:   ${f.operatorAction}`);
          lines.push(`      Deadline: ${f.deadline ?? 'N/A'}`);
          lines.push(`      Risk:     ${f.risk ?? 'N/A'}`);
        }
      }
    }
  } else {
    lines.push(`Validator ID:    ${report.validatorId ?? 'N/A'}`);
    lines.push(`Beacon Index:    ${report.beaconIndex ?? 'unassigned'}`);
    lines.push('--------------------------------------------------------------------------------');
    lines.push('FINDINGS:');
    for (const f of report.findings) {
      lines.push(`  ${statusColor(f.status)} ${f.ruleId} (${f.severity.toUpperCase()})`);
      lines.push(`    Explanation: ${f.explanation}`);
      if (f.operatorAction) {
        lines.push(`    Action:      ${f.operatorAction}`);
        lines.push(`    Deadline:    ${f.deadline ?? 'N/A'}`);
        lines.push(`    Risk:        ${f.risk ?? 'N/A'}`);
      }
      lines.push(`    Limitation:  ${f.limitation}`);
    }
  }

  lines.push('--------------------------------------------------------------------------------');
  lines.push('Read-only report; no transaction or protocol action was performed.');
  lines.push('================================================================================');

  return lines.join('\n');
}
