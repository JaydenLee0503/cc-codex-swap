#!/usr/bin/env node
// Print what HANDOFF.md would look like right now, given the current git state.
// Useful when iterating on handoff.ts or sanity-checking what the next agent
// will receive. Does not write to .swap/state/.
//
// Usage:
//   npm run handoff:preview
//   npm run handoff:preview -- --task "Refactor auth to JWT" --from claude --to codex

import { buildHandoff } from "../dist/handoff.js";

const args = parseArgs(process.argv.slice(2));

const task = args.task ?? "(no task prompt provided — pass --task \"...\" to set one)";
const from = args.from ?? "claude";
const to = args.to ?? "codex";
const reason = args.reason ?? "preview (no real rate-limit trigger)";

const tail = [
  "Next steps:",
  "- finish the JWT signing helper",
  "- wire it into the auth middleware",
  "- add tests for token expiry",
];

const doc = buildHandoff({
  taskPrompt: task,
  fromProvider: from,
  toProvider: to,
  reason,
  recentOutputTail: tail,
  cwd: process.cwd(),
  runState: {
    current_provider: from,
    task_prompt: task,
    start_time: new Date().toISOString(),
    switch_count: 0,
    last_switch_reason: null,
    providers_status: {},
  },
});

process.stdout.write(doc);
if (!doc.endsWith("\n")) process.stdout.write("\n");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}
