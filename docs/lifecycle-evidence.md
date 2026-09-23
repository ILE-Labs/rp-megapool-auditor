# Live lifecycle evidence inventory

These are real Hoodi captures committed with the repository, not fixture-only
examples.

| Capture | Contract state | Beacon state | Result |
|---|---|---|---|
| `live-hoodi-66d8-slot0` | `active` | `active_ongoing` | `HEALTHY` |
| `live-hoodi-0f3d-slot0` | `withdrawn` | `withdrawal_done` | `INCONCLUSIVE` (`RECON-008`) |
| `live-hoodi-0f3d-slot1` | `withdrawn` | `withdrawal_done` | `INCONCLUSIVE` (`RECON-008`) |

`captures/verified-batch-slot0/slot-0` is a newer live Hoodi smoke capture. It
verified chain ID `560048`, non-empty code at the supplied Megapool address,
and the active/active-ongoing cross-layer state. Its parent directory also
contains `batch-manifest.json`, proving the batch path produced a replayable
slot bundle. It is not a new lifecycle category; it strengthens the active
case and deployment evidence.

An exiting validator capture is still required. The repository must not claim
that all three lifecycle states have been captured until a real capture has a
Beacon status such as `exiting` or `active_exiting` and the report preserves
the corresponding finalized epoch and exit epoch.

The public Hoodi Beacon API currently exposed 125 `active_exiting` validators
when checked on 2026-09-23, but none of their withdrawal addresses had
deployed execution-layer code. The two already captured Megapools likewise
had no current `exiting` slot. Historical execution-layer state for one
captured Megapool showed `exiting`, but no archived Beacon state was available
from the tested public endpoints, so that historical observation is not being
presented as a synchronized cross-layer capture.

The committed completed-withdrawal captures are intentionally inconclusive:
the current Saturn ABI does not expose enough execution-side accounting state
to prove final balance settlement.
