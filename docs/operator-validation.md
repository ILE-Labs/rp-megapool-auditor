# Operator validation gate

The repository contains a parser and comparison report for Rocket Pool
Smartnode output, but the checked-in live captures do not yet contain output
from a real Smartnode installation. The synthetic comparison in the test suite
is a parser test, not operator confirmation.

The environment used for the live captures does not have the `rocketpool`
Smartnode CLI installed. No Smartnode output is therefore being claimed as
captured or compared. The comparison remains an explicit external validation
step, not a completed acceptance criterion.

## Required capture

On a Rocket Pool node using the same network and Megapool address as the
auditor capture, run:

```bash
rocketpool megapool status > capture/smartnode-status.txt
rocketpool megapool validators >> capture/smartnode-status.txt
node src/compare.mjs \
  --capture capture/live-hoodi-<address>-slot<n> \
  --smartnode capture/smartnode-status.txt \
  --out capture/operator-comparison.md
```

The comparison must use the same validator slot, Megapool address, network,
and execution snapshot as the auditor report. A reviewer should confirm that
the contract state and any exposed Smartnode fields agree, and identify which
fields the auditor can add beyond the Smartnode output.

## Acceptance evidence

The gate is satisfied only when one of the following is public:

1. a node operator or Rocket Pool maintainer confirms the comparison and says
   the cross-layer output is useful; or
2. a reproducible discrepancy is independently reviewed and accepted as a
   useful contribution.

The current repository has neither confirmation nor a real Smartnode capture.
No grant or production-integration claim should state otherwise.

