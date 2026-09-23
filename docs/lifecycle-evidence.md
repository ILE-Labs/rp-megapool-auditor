# Live lifecycle evidence inventory

The detailed Hoodi captures are retained locally and ignored by Git. The
publishable summary is `evidence/validated-scenarios.json`; it contains no raw
RPC responses, provider URLs, validator pubkeys, or operator-specific output.

| Capture | Contract state | Beacon state | Result |
|---|---|---|---|
| `live-hoodi-66d8-slot0` | `active` | `active_ongoing` | `HEALTHY` |
| `live-hoodi-66d8-slot1-publicnode` | `active` | `active_ongoing` | `HEALTHY` |
| `live-hoodi-0f3d-slot0` | `withdrawn` | `withdrawal_done` | `INCONCLUSIVE` (`RECON-008`) |
| `live-hoodi-0f3d-slot1` | `withdrawn` | `withdrawal_done` | `INCONCLUSIVE` (`RECON-008`) |

The local `captures/verified-batch-slot0/slot-0` bundle is a newer live Hoodi
smoke capture. It
verified chain ID `560048`, non-empty code at the supplied Megapool address,
and the active/active-ongoing cross-layer state. Its parent directory also
contains `batch-manifest.json`, proving the batch path produced a replayable
slot bundle. It is not a new lifecycle category; it strengthens the active
case and deployment evidence.

The local `captures/provenance-hoodi-66d8-slot0` bundle is a fresh live capture with canonical
Rocket Pool provenance. It verifies the supplied address against the live Hoodi
RocketStorage registry, MegapoolFactory expected address, factory deployment
flag, and NodeManager mapping. This closes the earlier weakness where the
auditor checked only bytecode presence.

The local `captures/negative-control-hoodi-lido-vault-publicnode` bundle is a live negative
control. The supplied address has code on Hoodi and passes the chain/code
check, but the Rocket Pool Megapool node getter reverts and canonical
provenance cannot be established. It is not counted as a Rocket Pool
lifecycle case. This demonstrates why bytecode presence alone must not be
treated as protocol identity; it does not claim a Rocket Pool incident.

The local `captures/live-hoodi-66d8-slot1-publicnode` bundle is a second live slot from the
same canonical Megapool. Its execution pubkey and withdrawal credentials
match the Beacon record and both layers report an active validator. It is a
real second scenario, but it is not an actionable discrepancy.

An exiting validator capture is still required. The repository must not claim
that all three lifecycle states have been captured until a real capture has a
Beacon status such as `exiting` or `active_exiting` and the report preserves
the corresponding finalized epoch and exit epoch.

The current public Beacon scan and the official mainnet MegapoolManager scan
did not produce a synchronized Rocket Pool `exiting` case: current
`active_exiting` withdrawal contracts did not match Rocket Pool Megapool
addresses, and all 4,975 current mainnet MegapoolManager records had
`exiting = false` at scan time. One apparent Hoodi candidate was verified as a
Lido withdrawal vault, not Rocket Pool. Historical execution-layer state for one
captured Megapool showed `exiting`, but no archived Beacon state was available
from the tested public endpoints, so that observation is not presented as a
synchronized cross-layer capture.

The committed completed-withdrawal captures are intentionally inconclusive:
the current Saturn ABI does not expose enough execution-side accounting state
to prove final balance settlement.
