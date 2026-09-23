# Operator validation gate

The repository contains a parser and comparison report for Rocket Pool
Smartnode output, but the checked-in live captures do not yet contain output
from a real Smartnode installation. The synthetic comparison in the test suite
is a parser test, not operator confirmation.

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

## Discussion-thread request

The application thread is reserved for applications. Ask for technical review
in the Round 41 discussion thread instead:

> ILE Labs has published a read-only Megapool cross-layer checker with a live
> Hoodi capture and replayable evidence. We are looking for one Rocket Pool
> node operator or maintainer to validate the operator-facing interpretation.
> In particular, we would like to compare one report against the output of
> `rocketpool megapool status` and `rocketpool megapool validators` for the
> same Megapool and validator slot. The tool deliberately reports missing
> Saturn ABI accounting fields as `INCONCLUSIVE` rather than inferring them.
>
> If someone can provide a redacted Smartnode capture or confirm that the
> comparison is useful, we will publish the comparison and adjust the tool to
> the current operator workflow. We are not asking anyone to run transactions
> or expose private keys.

Do not describe the operator gate as complete until a named operator or
maintainer replies, or a public comparison is independently reviewed.
