# CLAUDE.md

Brief for any agent (Claude Code or Codex) working in this repo. Codex reads the
near-identical `AGENTS.md`; keep them in sync.

## What this repo is

`swap` is a TypeScript/Node supervisor that runs Claude Code and Codex CLI as
child processes and hands the task off between them when one hits a
rate-limit/quota error. Full background is in `README.md`.

## Commands

```bash
npm install            # deps
npm run build          # tsc -p tsconfig.json -> dist/
npm test               # vitest run
npm run demo           # build, then `node dist/cli.js demo` (mock providers)
npm run handoff:preview  # print what HANDOFF.md would look like right now
npx tsc --noEmit       # typecheck only
```

Node 20+. TypeScript strict mode is on. `any` is banned in `src/` except where a
`// reason:` comment justifies it.

## Architecture (5 lines)

- `supervisor.ts` runs the main switch loop: spawn provider, stream output, swap on match.
- `detector.ts` tests each output line against the provider's `rate_limit_patterns`.
- `handoff.ts` builds `.swap/state/HANDOFF.md` (task + git log + git status + tail of agent output).
- `providers/` adapts each CLI (`claude.ts`, `codex.ts`, `mock.ts`) behind a common interface.
- `state.ts` owns all `.swap/state/` file I/O and log rotation.

## State location

Everything runtime lives under `.swap/state/` (gitignored):

- `run.json` — current run snapshot
- `HANDOFF.md` — latest handoff document
- `usage.jsonl` — append-only per-provider usage
- `swap.log` — pino logs, rotated at 10 MB
- `swap.pid` — supervisor PID (used by `swap stop`)

Config lives at `.swap/config.yaml` (also gitignored; scaffold with `swap init`).

## Conventions

- Tests use Vitest. The supervisor switch-cycle test uses `MockProvider` —
  do not introduce real network calls in tests.
- Logging goes through `src/logger.ts` (pino). Don't `console.log` in `src/`.
- Config is parsed with zod in `src/config.ts`. Add new fields to the schema,
  not as ad-hoc reads.
- Adding a provider: see the "Adding a new provider" section in `README.md`.
  Most cases need only a YAML edit, no new TypeScript.

## Before declaring a task done

Run `npx tsc --noEmit && npm test`. A `Stop` hook in `.claude/settings.json`
runs this automatically, but verify the output.
