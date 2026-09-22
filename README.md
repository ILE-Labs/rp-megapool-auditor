# rp-megapool-auditor

[![CI](https://github.com/rocket-pool/rp-megapool-auditor/actions/workflows/ci.yml/badge.svg)](https://github.com/rocket-pool/rp-megapool-auditor/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Read-only, evidence-backed cross-layer reconciler for  contracts and Ethereum  validator states.


---

## Features

- **Cross-Layer State Reconciliation:** Joins execution-layer megapool contract state with consensus-layer beacon validator records.
- **Evidence-Backed Findings:** Outputs structured contract and beacon values, stable rule IDs, operator actions, deadlines, risks, and explorer links.
- **Strictly Read-Only:** Zero private keys, no transaction signing, and no broadcast capabilities.
- **Safe Degradation:** Missing or failing RPC data emits `INCONCLUSIVE` (`BEACON-001`) and is never converted into false-negative findings.
- **Zero Runtime Dependencies:** Native Node.js ESM implementation using standard `fetch` and `node:http`.

---

## Quickstart

### 1. Run Offline Fixtures (Baseline Acceptance)

```bash
# Run terminal report on a withdrawable validator requiring contract notification
node src/cli.mjs --fixture fixtures/withdrawable.json

# Run healthy validator audit with Markdown output
node src/cli.mjs --fixture fixtures/healthy.json --format markdown

# Run inconclusive fixture with canonical JSON output
node src/cli.mjs --fixture fixtures/inconclusive.json --format json
```

### 2. Run Against Execution & Beacon RPC Endpoints

```bash
node src/cli.mjs \
  --megapool 0x1111111111111111111111111111111111111111 \
  --el-rpc http://127.0.0.1:8545 \
  --cl-rpc http://127.0.0.1:5052 \
  --validator-id v-withdrawable-004 \
  --network holesky \
  --format terminal
```

---

## CLI Options

| Flag | Description | Default |
|---|---|---|
| `--fixture <file>` | Path to offline JSON fixture capture | `fixtures/healthy.json` |
| `--megapool <address>` | Megapool execution contract address | `null` |
| `--el-rpc`, `--execution-rpc <url>` | Execution-layer JSON-RPC endpoint | `null` |
| `--cl-rpc`, `--beacon-rpc <url>` | Consensus-layer Beacon REST endpoint | `null` |
| `--validator-id <id>` | Validator ID or pubkey/index filter | `null` |
| `--block <number\|tag>` | Execution block tag or number | `latest` |
| `--network <name>` | Target network (`holesky`, `hoodi`, `mainnet`) | `holesky` |
| `--protocol-version <ver>` | Pinned protocol version | `saturn-1` |
| `--explorer-base-url <url>` | Execution block/address explorer base URL | `null` |
| `--cl-explorer-base-url <url>` | Consensus validator explorer base URL | `null` |
| `--format <type>` | Output format (`terminal`, `json`, `markdown`) | `terminal` |

---

## Test & Lint

```bash
# Run 18 unit, fixture, and mock RPC integration tests
npm test

# Run syntax lint checks
npm run lint
```

---

## Documentation

- [Overlap Audit](docs/overlap-audit.md) — Comparison against Smartnode CLI, Grafana, and Rocketwatch.
- [Protocol Scope](docs/protocol-scope.md) — Architecture, contract state, and beacon fields.
- [Reconciliation Rules](docs/rules.md) — Complete rule index, triggers, and severity profiles.
- [Limitations](docs/limitations.md) — Read-only boundaries and finality constraints.
- [Validation](docs/validation.md) — Verified capabilities, evidence boundaries, and limitations.
