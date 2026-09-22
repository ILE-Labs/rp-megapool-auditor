# Limitations & Operational Boundaries

`rp-megapool-auditor` is designed with explicit safety bounds and operational constraints:

---

## 1. Safety & Security Boundaries

- **Strictly Read-Only:** The auditor does not request, store, or handle private keys, mnemonic seeds, or signer configurations.
- **No Transaction Broadcast:** The tool outputs recommended operator commands (e.g., `rocketpool megapool notify-validator-exit`), but does not sign or submit transactions.
- **No Loss-Prevention Guarantees:** A `HEALTHY` finding indicates that the snapshot exhibits no cross-layer discrepancies at the evaluated block and epoch; it does not guarantee future validator uptime, network finality, or protocol solvency.

---

## 2. Inconclusive Data Handling

- **Zero False-Negative Inferences:** If the execution RPC or beacon REST endpoint fails, times out, or returns a 5xx status code, the auditor emits `INCONCLUSIVE` (`BEACON-001`). It **never** converts missing RPC data into a negative finding or assumed penalty.

---

## 3. Protocol Version Pinning

- The auditor ruleset is pinned to `saturn-1`. If an execution-layer contract reports an unsupported protocol version, rule `VERSION-001` (`UNSUPPORTED_VERSION`) is triggered, preventing erroneous rule evaluations against incompatible contract storage layouts.

---

## 4. Finality & Consensus Delay

- Beacon-chain queries inspect the **finalized** state boundary. Transient unfinalized forks, reorgs, or consensus gossip latency (< 2 epochs) may temporarily manifest as `INCONCLUSIVE` (`RECON-002`) until finalized on-chain.
