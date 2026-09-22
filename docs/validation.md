# Validation

## Verified capabilities

- Reads Megapool contract state through the supported ABI.
- Reads Beacon Chain validator state.
- Correlates validator pubkeys across both layers.
- Checks withdrawal credentials against the execution-layer address.
- Produces healthy, review-required, and inconclusive outcomes.
- Replays captured evidence without network access.
- Runs through automated tests and CI.

## Live observations

The repository contains redacted Hoodi captures produced from deployed contracts
and Beacon Chain data. The captures demonstrate cross-layer correlation and
conservative handling of incomplete contract state.

The captures do not claim a mainnet incident, a protocol defect, or replacement
of existing node-management software.

## Boundaries

- The tool is read-only and never signs or broadcasts transactions.
- Missing or conflicting data is reported as inconclusive unless the evidence
  supports a stronger result.
- The current contract interface does not expose every accounting field needed
  to prove final post-withdrawal settlement in all cases.
- Live captures are snapshots; replay is deterministic only for the captured
  inputs.

## Reproduce

```bash
npm ci
npm test
npm run lint
node src/cli.mjs --fixture fixtures/healthy.json --format json
node src/cli.mjs --fixture fixtures/withdrawable.json --format markdown
node src/cli.mjs --fixture fixtures/inconclusive.json --format terminal
```

The fixture commands exercise the rules engine. The `captures/` directory
contains the corresponding evidence artifacts and generated reports.
