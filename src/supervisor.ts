import { type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createInterface } from "node:readline";
import type { Logger } from "pino";
import { buildHandoff } from "./handoff.js";
import { StateStore } from "./state.js";
import type {
  BackoffConfig,
  Provider,
  ProviderStatus,
  RunState,
  SwapConfig,
} from "./types.js";

const RECENT_TAIL_LINES = 200;

export interface SupervisorDeps {
  config: SwapConfig;
  providers: Map<string, Provider>;
  store: StateStore;
  logger: Logger;
  cwd: string;
  // Used by tests to bound execution.
  maxSwitches?: number;
  // Used by tests to stub the wall clock for backoff/healthcheck.
  sleeper?: (ms: number) => Promise<void>;
}

export interface RunOptions {
  taskPrompt: string;
  initialProvider?: string;
}

interface ChildOutcome {
  rateLimited: boolean;
  reason: string | null;
  exitCode: number | null;
  recentLines: string[];
  charsOut: number;
}

export class Supervisor {
  private readonly d: SupervisorDeps;
  private currentChild: ChildProcess | null = null;
  private stopRequested = false;

  constructor(deps: SupervisorDeps) {
    this.d = deps;
  }

  async run(opts: RunOptions): Promise<RunState> {
    const initial = opts.initialProvider ?? this.d.config.primary;
    let state = this.initState(opts.taskPrompt, initial);
    this.persist(state);

    let providerName = initial;
    let prompt = opts.taskPrompt;
    const maxSwitches = this.d.maxSwitches ?? Number.POSITIVE_INFINITY;
    let backoffSeconds = this.d.config.backoff.initial_seconds;

    while (!this.stopRequested) {
      const provider = this.d.providers.get(providerName);
      if (!provider) {
        this.d.logger.error({ providerName }, "unknown provider, aborting");
        break;
      }

      this.d.logger.info({ provider: providerName }, "launching provider");
      const outcome = await this.runOnce(provider, prompt, state);

      this.recordUsage(provider.name, prompt.length, outcome.charsOut);
      state.providers_status[provider.name] = {
        available: !outcome.rateLimited,
        lastCheck: new Date().toISOString(),
        lastRateLimitAt: outcome.rateLimited
          ? new Date().toISOString()
          : state.providers_status[provider.name]?.lastRateLimitAt ?? null,
      };

      if (!outcome.rateLimited) {
        this.d.logger.info(
          { provider: providerName, exitCode: outcome.exitCode },
          "provider exited without hitting rate limit",
        );
        this.persist(state);
        break;
      }

      if (state.switch_count >= maxSwitches) {
        this.d.logger.warn({ switch_count: state.switch_count }, "max switches reached");
        this.persist(state);
        break;
      }

      const next = this.pickNext(providerName, state);
      const reason = outcome.reason ?? "rate limit detected";
      const handoff = buildHandoff({
        taskPrompt: opts.taskPrompt,
        fromProvider: providerName,
        toProvider: next ?? "(none available)",
        reason,
        recentOutputTail: outcome.recentLines,
        cwd: this.d.cwd,
        runState: state,
      });
      this.d.store.writeHandoff(handoff);
      this.d.logger.info({ from: providerName, to: next, reason }, "handoff written");

      state = {
        ...state,
        switch_count: state.switch_count + 1,
        last_switch_reason: reason,
        current_provider: next ?? providerName,
      };
      this.persist(state);

      if (!next) {
        const available = await this.waitForAnyAvailable(state, backoffSeconds);
        backoffSeconds = Math.min(
          backoffSeconds * 2,
          this.d.config.backoff.max_seconds,
        );
        if (!available) {
          this.d.logger.warn("no provider became available, exiting");
          break;
        }
        providerName = available;
        backoffSeconds = this.d.config.backoff.initial_seconds;
      } else {
        providerName = next;
      }

      prompt = handoff;
      state.current_provider = providerName;
      this.persist(state);
    }

    if (this.stopRequested) {
      this.d.logger.info("stop requested, exiting cleanly");
    }
    return state;
  }

  stop(): void {
    this.stopRequested = true;
    if (this.currentChild && this.currentChild.exitCode === null) {
      try {
        this.currentChild.kill();
      } catch (err) {
        this.d.logger.warn({ err: String(err) }, "failed to kill child");
      }
    }
  }

  private initState(taskPrompt: string, providerName: string): RunState {
    const existing = this.d.store.readRun();
    if (existing && existing.task_prompt === taskPrompt) {
      this.d.logger.info("resuming existing run state");
      return existing;
    }
    const providers_status: Record<string, ProviderStatus> = {};
    for (const p of this.d.providers.keys()) {
      providers_status[p] = {
        available: true,
        lastCheck: new Date().toISOString(),
        lastRateLimitAt: null,
      };
    }
    return {
      current_provider: providerName,
      task_prompt: taskPrompt,
      start_time: new Date().toISOString(),
      switch_count: 0,
      last_switch_reason: null,
      providers_status,
      pid: process.pid,
    };
  }

  private persist(state: RunState): void {
    try {
      this.d.store.writeRun(state);
    } catch (err) {
      this.d.logger.error({ err: String(err) }, "failed to persist run state");
    }
  }

  private recordUsage(provider: string, charsIn: number, charsOut: number): void {
    try {
      this.d.store.appendUsage({
        ts: new Date().toISOString(),
        provider,
        chars_in: charsIn,
        chars_out: charsOut,
      });
    } catch (err) {
      this.d.logger.warn({ err: String(err) }, "failed to record usage");
    }
  }

  private async runOnce(
    provider: Provider,
    prompt: string,
    _state: RunState,
  ): Promise<ChildOutcome> {
    return new Promise((resolveOutcome) => {
      const recent: string[] = [];
      let rateLimited = false;
      let reason: string | null = null;
      let charsOut = 0;
      let settled = false;

      let child: ChildProcess;
      try {
        child = provider.spawn(prompt, { cwd: this.d.cwd, env: process.env });
      } catch (err) {
        this.d.logger.error({ err: String(err), provider: provider.name }, "spawn failed");
        resolveOutcome({
          rateLimited: false,
          reason: `spawn failed: ${String(err)}`,
          exitCode: null,
          recentLines: [],
          charsOut: 0,
        });
        return;
      }
      this.currentChild = child;

      const finish = (outcome: ChildOutcome): void => {
        if (settled) return;
        settled = true;
        this.currentChild = null;
        resolveOutcome(outcome);
      };

      const handleLine = (line: string): void => {
        if (line.length === 0) return;
        recent.push(line);
        if (recent.length > RECENT_TAIL_LINES) recent.shift();
        charsOut += line.length;
        if (!rateLimited && provider.isRateLimited(line)) {
          rateLimited = true;
          reason = `pattern matched on output: "${line.slice(0, 200)}"`;
          this.d.logger.warn({ provider: provider.name, line: line.slice(0, 200) }, "rate limit detected");
          try {
            child.kill();
          } catch {
            // ignore
          }
        }
      };

      if (child.stdout) {
        const rl = createInterface({ input: child.stdout });
        rl.on("line", handleLine);
      }
      if (child.stderr) {
        const rl = createInterface({ input: child.stderr });
        rl.on("line", handleLine);
      }

      child.on("error", (err) => {
        this.d.logger.error({ err: String(err), provider: provider.name }, "child error");
        finish({
          rateLimited: false,
          reason: `child error: ${String(err)}`,
          exitCode: null,
          recentLines: recent,
          charsOut,
        });
      });

      child.on("exit", (code) => {
        finish({
          rateLimited,
          reason,
          exitCode: code,
          recentLines: recent,
          charsOut,
        });
      });
    });
  }

  private pickNext(current: string, state: RunState): string | null {
    const chain = this.d.config.fallback_chain;
    const candidates = chain.filter((n) => n !== current);
    for (const c of candidates) {
      const s = state.providers_status[c];
      if (!s || s.available) return c;
    }
    return null;
  }

  private async waitForAnyAvailable(
    state: RunState,
    initialBackoffSeconds: number,
  ): Promise<string | null> {
    const sleeper = this.d.sleeper ?? ((ms: number) => sleep(ms));
    const backoffMs = Math.min(
      initialBackoffSeconds * 1000,
      this.d.config.backoff.max_seconds * 1000,
    );
    this.d.logger.info({ backoffMs }, "all providers rate-limited, sleeping before re-check");
    await sleeper(backoffMs);
    if (this.stopRequested) return null;

    for (const name of this.d.config.fallback_chain) {
      const p = this.d.providers.get(name);
      if (!p) continue;
      let ok = false;
      try {
        ok = await p.isAvailable();
      } catch (err) {
        this.d.logger.warn({ err: String(err), provider: name }, "healthcheck threw");
      }
      state.providers_status[name] = {
        available: ok,
        lastCheck: new Date().toISOString(),
        lastRateLimitAt: ok ? null : state.providers_status[name]?.lastRateLimitAt ?? null,
      };
      if (ok) {
        this.d.logger.info({ provider: name }, "provider available again");
        return name;
      }
    }
    return null;
  }
}

export function backoffNext(current: number, cfg: BackoffConfig): number {
  return Math.min(current * 2, cfg.max_seconds);
}
