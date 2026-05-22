---
description: Run tsc --noEmit and report only errors.
---

Run `npx tsc --noEmit` and report:

- pass/fail
- if failed, the errors grouped by file with line numbers as `path:line:col`
- nothing else — no summary of "what TypeScript is", no recap of clean files
