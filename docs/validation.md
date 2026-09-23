# Validation

## Verified capabilities

- Reads Megapool contract state through the supported ABI.
- Reads Beacon Chain validator state.
- Correlates validator pubkeys across both layers.
- Checks withdrawal credentials against the execution-layer address.
- Produces healthy, review-required, and inconclusive outcomes.
- Replays captured evidence without network access.
- Runs through automated tests and CI.
- Validates live execution-chain identity, bytecode presence, and requested protocol ruleset before using live data.
- Supports a live `--all` scan over every validator slot returned by `getValidatorCount()`.

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

## Live deployment and batch checks

For live use, provide the expected chain ID and protocol version explicitly:

```bash
node src/cli.mjs \
  --all \
  --megapool 0x... \
  --el-rpc https://... \
  --cl-rpc https://... \
  --network hoodi \
  --chain-id 560048 \
  --protocol-version saturn-1 \
  --format json
```

The tool checks address format, `eth_chainId`, and non-empty bytecode. These
checks prove that code exists at the supplied address on the queried chain;
they do not by themselves prove that the address is the intended official
Rocket Pool deployment. The current Saturn ABI also omits some accounting
flags, so the auditor retains `INCONCLUSIVE` results where execution state
cannot be proven.

See [operator validation](operator-validation.md) and [lifecycle evidence](lifecycle-evidence.md)
for the external confirmation and real-capture gates that remain open.

For raw evidence capture across a pool, use `npm run capture:batch -- ...`.
The command captures slots sequentially into replayable subdirectories and
writes `batch-manifest.json`; sequential operation is deliberate because
public RPC endpoints often rate-limit a full-pool fan-out.
