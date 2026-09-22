# Protocol Scope & Architecture

`rp-megapool-auditor` is designed specifically for the Rocket Pool Saturn 1 Megapool protocol architecture.

---

## 1. Scope of Inspection

The auditor inspects the cross-layer lifecycle of Rocket Pool validators operating under Megapool contracts:

```
+--------------------------------------------------------------------------------+
|                             EXECUTION LAYER (EL)                               |
|                                                                                |
|  Megapool Contract State:                                                      |
|   - validatorId, beaconIndex, state (active / queued / exit_in_progress)       |
|   - exitNotified, balanceFinalized, dissolved, dissolutionEpoch                |
|   - lastDistributionTime                                                       |
+--------------------------------------------------------------------------------+
                                       |
                                       | Cross-Layer Snapshot Reconciliation
                                       v
+--------------------------------------------------------------------------------+
|                             CONSENSUS LAYER (CL)                               |
|                                                                                |
|  Beacon-Chain Validator Record (Finalized State):                              |
|   - validatorIndex, pubkey, withdrawal_credentials                             |
|   - status (active_ongoing, exiting, withdrawal_possible, withdrawal_done)     |
|   - activation_epoch, exit_epoch, withdrawable_epoch, finalized_epoch          |
+--------------------------------------------------------------------------------+
```

---

## 2. Pinned Protocol Versions

- **Supported Version:** `saturn-1`
- Any unsupported or unpinned protocol version triggers rule `VERSION-001` (`UNSUPPORTED_VERSION`) to prevent ABI mismatch or incorrect state assumptions.

---

## 3. Network Support

- **Default Networks:** `holesky`, `hoodi`, `mainnet`
- Custom RPC endpoints for EL (JSON-RPC) and CL (Beacon REST) can be supplied via `--el-rpc` and `--cl-rpc`.
- Offline audits can be performed on deterministic JSON fixture captures.

---

## 4. Strict Safety Boundaries

1. **Read-Only:** No state-modifying operations or private keys.
2. **No Transaction Signer or Broadcaster:** The tool tells the operator *what* action is due and *why*, but the operator executes actions through official Rocket Pool Smartnode or multisig contracts.
3. **Graceful Degradation:** When beacon consensus endpoints are unreachable or desynchronized, the tool reports `INCONCLUSIVE` under `BEACON-001`. It never interprets network downtime as validator misbehavior.
