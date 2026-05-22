---
description: Read .swap/state/ and report current run, last handoff, recent log lines.
---

Report the current supervisor state without changing anything.

1. If `.swap/state/run.json` exists, show: current provider, switch count, last reason, per-provider status.
2. If `.swap/state/HANDOFF.md` exists, show the header (From / To / Reason / Timestamp / Switch count).
3. Show the last 20 lines of `.swap/state/swap.log` if present.
4. If `.swap/state/swap.pid` exists, note that a supervisor may be running.

If no state directory exists, say so — don't create one.
