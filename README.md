# swap

`swap` is a small Node/TypeScript supervisor that runs **Claude Code** and **OpenAI Codex CLI** as child processes and automatically hands off the task between them when one hits a rate limit, quota, or weekly cap.

It exists so a long-running autonomous coding session can keep working past any single provider's quota without you copy-pasting context by hand.

---

## Install

Requires Node.js 20+.

```bash
git clone <this-repo> swap
cd swap
npm install
npm run build
```

You can run the built CLI directly:

```bash
node dist/cli.js --help
```

Or link it on your PATH:

```bash
npm link        # adds `swap` to PATH
swap --help
```

You'll also need `claude` and `codex` binaries on your PATH for real (non-demo) use. The demo command needs neither.

---

## Configure

`swap` looks for `.swap/config.yaml` in the current working directory. If absent, it falls back to a sensible default that matches stock `claude` + `codex --full-auto` invocations.

To scaffold a config:

```bash
swap init
```

Example `.swap/config.yaml`:

```yaml
providers:
  - name: claude
    command: claude
    args: []
    rate_limit_patterns:
      - "rate limit"
      - "you've reached your weekly"
      - "5-hour limit"
  - name: codex
    command: codex
    args: ["--full-auto"]
    rate_limit_patterns:
      - "quota exceeded"
      - "usage limit"
primary: claude
fallback_chain: [claude, codex]
healthcheck_interval_seconds: 300
backoff:
  initial_seconds: 60
  max_seconds: 3600
```

| Field | Meaning |
|---|---|
| `providers[].command` / `args` | How to launch this provider. |
| `providers[].rate_limit_patterns` | Case-insensitive regexes matched against each stdout/stderr line. A match triggers a handoff. |
| `providers[].status_check` | Optional `{command, args}` used for healthchecks. Default: `<command> --version`. |
| `primary` | Which provider starts first. |
| `fallback_chain` | Order to try when handing off. |
| `healthcheck_interval_seconds` | How often to re-check a rate-limited provider's availability while sleeping. |
| `backoff` | Exponential backoff bounds when **all** providers are rate-limited. Doubles each sleep, capped at `max_seconds`. |

---

## Run

```bash
# Start a new run with a task prompt
swap start "Refactor the auth module to use JWT and add tests"

# Check current status (current provider, switch count, usage totals)
swap status

# Gracefully stop the running supervisor
swap stop

# Run the full switching cycle against mock providers (no real API calls)
swap demo
```

State is persisted under `.swap/state/`:

- `run.json` — current run snapshot (provider, switch count, last reason, per-provider status)
- `HANDOFF.md` — the latest handoff document written when a switch happens
- `usage.jsonl` — append-only usage analytics (chars in/out per provider)
- `swap.log` — structured pino logs, rotated at 10 MB
- `swap.pid` — PID of the running supervisor (used by `swap stop`)

---

## Handoff format

When a provider hits a rate-limit pattern, `swap` writes `.swap/state/HANDOFF.md` and feeds it to the next provider as the initial prompt. The document contains:

```markdown
# Swap Handoff

- **From provider:** claude
- **To provider:** codex
- **Reason:** pattern matched on output: "Error: rate limit reached"
- **Timestamp:** 2026-05-21T20:57:47.963Z
- **Switch count:** 1
- **Started:** 2026-05-21T20:50:00.000Z

## Original Task
<the original `swap start` prompt verbatim>

## Recent Work (git log)
<output of `git log --oneline -n 20`>

## Files In Progress (git status)
<output of `git status --short`>

## Next Steps (from previous agent output)
<any "Next steps:" / "TODO:" block extracted from the previous agent's tail output>

## Resume Instructions
<instructions to the new agent to continue the task from current repo state>
```

The new provider sees this document as its initial input, so it has the original task, what the previous agent committed, what was in progress, and any TODO-style notes the previous agent left in its stdout.

---

## How switching works

1. Supervisor spawns the primary provider with the task prompt and streams its stdout/stderr line-by-line.
2. Each line is tested against the provider's `rate_limit_patterns`. On a match, the child is killed.
3. A `HANDOFF.md` is built from the original prompt, git state, and the last ~200 lines of the agent's output.
4. The next provider in `fallback_chain` is launched with the handoff as its prompt.
5. If **all** providers are rate-limited, the supervisor sleeps with exponential backoff (`initial_seconds` doubling up to `max_seconds`), then health-checks each provider via `--version` (or the configured `status_check`). The first one that responds is resumed with the handoff.
6. The loop continues until a provider exits without a rate-limit hit, or `swap stop` is called.

The supervisor process never crashes on a child error — spawn failures, mid-stream errors, and non-zero exits are all logged and the loop continues or terminates gracefully.

---

## Adding a new provider

1. Create `src/providers/<name>.ts` exporting a class that implements:

   ```ts
   interface Provider {
     name: string;
     spawn(prompt: string, opts: SpawnOpts): ChildProcess;
     isRateLimited(line: string): boolean;
     isAvailable(): Promise<boolean>;
   }
   ```

2. Wire it into `src/providers/index.ts` so `buildProvider({name: "<name>", ...})` returns your class.
3. Add an entry to `.swap/config.yaml` under `providers:` with your `command`, `args`, and `rate_limit_patterns`. Add the name to `fallback_chain`.
4. Add a test under `tests/` using the `MockProvider` helper as a template if you need to simulate stdout behavior.

The simplest case (a CLI that takes the prompt on stdin and emits to stdout, with rate-limit phrases that match a regex) needs no new TypeScript — just edit the YAML.

---

## Known limitations

- **Pattern-based detection is heuristic.** If a provider changes its rate-limit phrasing, you have to update `rate_limit_patterns`. Usage estimation (`usage.jsonl`) is a secondary signal but is not currently a trigger.
- **Healthchecks default to `--version`.** That confirms the binary works, not that the upstream API is unblocked. If a provider exposes a real status command, set it under `status_check` in the config.
- **No mid-stream resume.** When a switch happens the next agent gets the original task plus the handoff document — it does not see the partial state the previous agent had in memory. Agents are expected to leave breadcrumbs in commits and `Next steps:` lines in their output for the handoff to capture.
- **One supervisor per repo.** `swap status` and `swap stop` use `.swap/state/swap.pid`; running two supervisors in the same working directory will clobber it.
- **Single-host only.** No coordination between machines; the supervisor process must stay alive on the host where the work is happening.
- **stdin not interactive.** The Claude adapter uses `claude -p "<prompt>"`; Codex uses `codex --full-auto` with the prompt piped on stdin. Long-form interactive use (REPL-style) is out of scope.

---

## Project layout

```
src/
  cli.ts              entry point (commander)
  supervisor.ts       main switch loop
  detector.ts         rate-limit regex matching
  handoff.ts          HANDOFF.md builder (git log + git status + tail)
  state.ts            .swap/state/ file I/O, log rotation
  config.ts           YAML + zod validation
  logger.ts           pino logger with file mirror
  demo.ts             swap demo wiring
  providers/
    claude.ts         Claude Code adapter
    codex.ts          Codex CLI adapter
    mock.ts           in-process mock for tests + demo
    index.ts          provider factory
tests/
  detector.test.ts
  handoff.test.ts
  config.test.ts
  supervisor.test.ts  full switch cycle against mocks
```

---

## Development

```bash
npm install        # deps
npm run build      # tsc -p tsconfig.json
npm test           # vitest run
npm run demo       # build first, then runs `node dist/cli.js demo`
```

TypeScript strict mode is on. `any` is banned in `src/` except where a `// reason:` comment justifies it.
