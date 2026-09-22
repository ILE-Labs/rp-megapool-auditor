# Reconciliation Rules Catalog

Every reconciliation rule evaluated by `rp-megapool-auditor` provides a stable rule ID, outcome status, severity level, plain-language explanation, recommended operator action, deadline/risk profile, and an explicit limitation.

---

## Rules Index

| Rule ID | Status | Severity | Trigger Condition |
|---|---|---|---|
| **`VERSION-001`** | `UNSUPPORTED_VERSION` | High | Metadata `protocolVersion` is missing or not in supported set (`saturn-1`). |
| **`BEACON-001`** | `INCONCLUSIVE` | Medium | Beacon node REST endpoint is unreachable, timed out, or returned 5xx. |
| **`RECON-000`** | `HEALTHY` | Info | Execution and beacon records are fully aligned; validator is actively attesting. |
| **`RECON-001`** | `ACTION_REQUIRED` | High | Contract records validator as active, but beacon node returns 404 Not Found. |
| **`RECON-002`** | `INCONCLUSIVE` | High | Contract records exit in progress, but beacon validator is active with no exit epoch. |
| **`RECON-003`** | `ACTION_REQUIRED` | High | Beacon validator has reached withdrawable epoch, but `exitNotified` is false. |
| **`RECON-004`** | `ACTION_SOON` | Medium | Validator is in beacon exit queue with a finite future withdrawable epoch. |
| **`RECON-005`** | `ACTION_REQUIRED` | High | Validator is marked `dissolved`; settlement/penalty proof action pending. |
| **`RECON-006`** | `HEALTHY` | Info | Validator is queued/staked in contract awaiting initial beacon index assignment. |
| **`RECON-007`** | `HEALTHY` | Info | Validator withdrawal and contract state settlement have completed successfully. |
| **`RECON-008`** | `ACTION_REQUIRED` | High | Beacon withdrawal sweep complete, but contract `balanceFinalized` is false. |

---

## Detailed Rule Specifications

### `RECON-003`: Overdue Contract Exit Notification
- **Trigger:** `beacon.status === 'withdrawal_possible'` AND `!contract.exitNotified`
- **Status:** `ACTION_REQUIRED`
- **Severity:** High
- **Operator Action:** Execute `rocketpool megapool notify-validator-exit --validator-id <id>`.
- **Deadline:** Overdue as withdrawable epoch is finalized on consensus layer.
- **Risk:** Staked funds remain locked in the consensus withdrawal pipeline and cannot be distributed to the megapool vault or node operator.
- **Limitation:** The auditor reports the missing notification; it does not broadcast the transaction.

### `RECON-004`: Exit in Progress with Finite Withdrawable Epoch
- **Trigger:** `beacon.status === 'exiting'` AND `beacon.withdrawableEpoch !== null`
- **Status:** `ACTION_SOON`
- **Severity:** Medium
- **Operator Action:** Prepare for execution-layer notification once the withdrawable epoch is reached.
- **Deadline:** Approaching withdrawable epoch.
- **Risk:** Validator must maintain consensus client uptime until the exit epoch completes to avoid inactivity penalties.
- **Limitation:** The auditor does not project variable gas prices or exact block timestamps.

### `RECON-001`: Active Contract Validator Absent on Beacon Chain
- **Trigger:** `contract.state === 'active'` AND `beacon.status === 'not_found'`
- **Status:** `ACTION_REQUIRED`
- **Severity:** High
- **Operator Action:** Check validator deposit transaction logs, verify beacon index assignment, and check consensus client synchronization.
- **Risk:** Potential lost deposit, unassigned index reorg, or severe consensus client desync.
- **Limitation:** Confirm beacon client freshness and execution block pin before taking destructive actions.

### `BEACON-001`: Beacon Data Unavailable
- **Trigger:** `beacon === null` (HTTP 5xx, connection refused, or timeout)
- **Status:** `INCONCLUSIVE`
- **Severity:** Medium
- **Operator Action:** Verify consensus client health and restart query.
- **Limitation:** Missing data is never treated as a negative finding or protocol failure.
