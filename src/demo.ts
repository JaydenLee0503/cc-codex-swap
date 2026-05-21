import { StateStore } from "./state.js";
import { Supervisor } from "./supervisor.js";
import { MockProvider } from "./providers/mock.js";
import { createLogger } from "./logger.js";
import type { Provider, SwapConfig } from "./types.js";

export async function runDemo(cwd: string = process.cwd()): Promise<number> {
  const store = new StateStore(cwd);
  store.ensure();
  const logger = createLogger(store, "info");

  const claudeMock = new MockProvider("claude", {
    available: true,
    events: [
      { delayMs: 30, line: "working on it..." },
      { delayMs: 30, line: "Error: rate limit reached, please try again later" },
    ],
  });
  const codexMock = new MockProvider("codex", {
    available: true,
    events: [
      { delayMs: 30, line: "codex picking up handoff..." },
      { delayMs: 30, line: "Error: quota exceeded for current period" },
    ],
  });

  // Behavior queues for the second time we visit each provider.
  let claudeVisits = 0;
  let codexVisits = 0;
  const claudeWrapped: Provider = {
    name: "claude",
    spawn: (prompt, opts) => {
      claudeVisits += 1;
      if (claudeVisits === 1) {
        claudeMock.setBehavior({
          available: true,
          events: [
            { delayMs: 20, line: "claude run #1 working" },
            { delayMs: 20, line: "Error: rate limit reached" },
          ],
        });
      } else {
        claudeMock.setBehavior({
          available: true,
          events: [
            { delayMs: 20, line: "claude resumed after backoff" },
            { delayMs: 20, line: "task complete" },
          ],
        });
      }
      return claudeMock.spawn(prompt, opts);
    },
    isRateLimited: (l) => claudeMock.isRateLimited(l),
    isAvailable: async () => claudeMock.isAvailable(),
  };
  const codexWrapped: Provider = {
    name: "codex",
    spawn: (prompt, opts) => {
      codexVisits += 1;
      codexMock.setBehavior({
        available: false,
        events: [
          { delayMs: 20, line: "codex run #" + codexVisits },
          { delayMs: 20, line: "Error: quota exceeded" },
        ],
      });
      return codexMock.spawn(prompt, opts);
    },
    isRateLimited: (l) => codexMock.isRateLimited(l),
    isAvailable: async () => codexMock.isAvailable(),
  };

  const config: SwapConfig = {
    providers: [
      { name: "claude", command: "node", args: [], rate_limit_patterns: ["rate limit"] },
      { name: "codex", command: "node", args: [], rate_limit_patterns: ["quota exceeded"] },
    ],
    primary: "claude",
    fallback_chain: ["claude", "codex"],
    healthcheck_interval_seconds: 1,
    backoff: { initial_seconds: 1, max_seconds: 4 },
  };

  // After the codex run, the next pickNext() will return null and trigger the
  // sleep-then-healthcheck path. We flip claude available=true so it picks up.
  const supervisor = new Supervisor({
    config,
    providers: new Map<string, Provider>([
      ["claude", claudeWrapped],
      ["codex", codexWrapped],
    ]),
    store,
    logger,
    cwd,
    maxSwitches: 5,
    sleeper: async (ms) => {
      logger.info({ ms }, "demo sleeper invoked (instant)");
    },
  });

  logger.info("starting swap demo (mocked providers)");
  const final = await supervisor.run({ taskPrompt: "demo task: keep coding through any rate limits" });
  logger.info(
    {
      switches: final.switch_count,
      current: final.current_provider,
      reason: final.last_switch_reason,
    },
    "demo finished",
  );
  return final.switch_count >= 2 ? 0 : 1;
}
