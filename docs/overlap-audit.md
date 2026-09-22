# Overlap Audit

**Date:** 2026-09-22  
**Target Surface:** Rocket Pool Saturn 1 Megapool Architecture & Operator Tooling  

---

## 1. Existing Tooling Coverage Analysis

| Tool | Primary Purpose | Layer Visibility | Action / Reconciliation Gap |
|---|---|---|---|
| **Smartnode CLI** (`rocketpool megapool status`, `validators`) | Node management & interactive transaction execution | Execution contracts + local node daemon | Displays contract states and prompts actions. Does not perform cross-layer discrepancy verification (e.g. detecting when beacon epoch is withdrawable while contract `exitNotified` flag is missing, or highlighting stuck unfinalized exits). |
| **Rocketwatch / Discord Bot** | Event alerting & community notifications | Execution event logs | Broadcasts real-time events (rewards, minipool deposits). Does not evaluate point-in-time cross-layer state consistency or deterministic offline snapshots. |
| **Grafana / Prometheus Metrics** | Operational telemetry & attestation monitoring | Local node telemetry & beacon client | Monitors peer count, CPU, sync status, and attestation rate. Does not inspect contract accounting flags (`balanceFinalized`, `dissolved`, proof window expiry). |
| **Beaconcha.in / Consensus Explorers** | Validator beacon-chain explorer | Consensus layer only | Shows validator balance, epochs, and status on the beacon chain. Unaware of Megapool vault contracts, distribution rules, or operator obligations. |
| **Rocket Pool Web App** | Web UI for rETH stakers and node operator onboarding | Execution layer RPC | Web interface for staking and reward claims. Not designed for automated operator audit, batch reconciliation, or offline verification. |

---

## 2. The Cross-Layer Operational Problem

In the Rocket Pool Saturn 1 Megapool design, validator lifecycle transitions span two asynchronous layers:
1. **Consensus Layer (Beacon Chain):** Handles activation, validator voluntary exits, validator sweeping, and withdrawability epochs (`exit_epoch`, `withdrawable_epoch`).
2. **Execution Layer (Megapool Contracts):** Handles vault accounting, express deposits, stake rebalancing, `notifyValidatorExit`, `notifyFinalBalance`, and `dissolve`.

### Concrete Failure Modes Uncovered by Cross-Layer Auditing:
- **Overdue Exit Notification (`RECON-003`):** A validator completes its exit and reaches `withdrawable_epoch` on the beacon chain, but the operator or protocol has not called `notifyValidatorExit` on the Megapool. Funds remain idle in the beacon withdrawal queue without triggering execution-layer distribution.
- **Premature Node Shutdown (`RECON-002`):** The contract registers an exit in progress, but the consensus voluntary exit was never broadcast or dropped. If the operator shuts down their validator client assuming the exit is active, the validator suffers inactivity penalties.
- **Unsettled Completed Sweeps (`RECON-008`):** Beacon withdrawal is marked complete and funds swept into the execution vault, but `balanceFinalized` remains unexecuted, blocking reward distribution.
- **Missing Beacon Validator (`RECON-001`):** Execution contract marks validator as active with an assigned index, but the beacon chain has no record of the validator (deposit lost or reorged).

---

## 3. Strict Boundary & Non-Goals

`rp-megapool-auditor` adheres to strict operational boundaries:
- **Read-Only:** No private key access, wallet connection, transaction signing, or broadcasting.
- **Deterministic & Offline-First:** Operates on version-pinned snapshots and deterministic fixtures.
- **Evidence-Backed:** Every finding produces exact contract and beacon fields, stable rule IDs, operator actions, deadlines, risks, and explicit limitations.
- **Never Guesses:** Missing RPC data emits `INCONCLUSIVE` (`BEACON-001`) and is never converted into a negative finding.

---

## 4. Differentiation Conclusion

`rp-megapool-auditor` is differentiated from existing single-layer tools by joining execution-layer megapool accounting state with consensus-layer beacon validator lifecycle state, producing a single actionable answer:
> *Does this validator or megapool require an operator action now, what evidence supports that conclusion, and is there a deadline or risk?*
