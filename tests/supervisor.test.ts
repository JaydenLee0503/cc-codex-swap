import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { Supervisor } from "../src/supervisor.js";
import { StateStore } from "../src/state.js";
import { MockProvider } from "../src/providers/mock.js";
import type { Provider, SwapConfig } from "../src/types.js";

function silentLogger() {
  return pino({ level: "silent" });
}

const baseConfig: SwapConfig = {
  providers: [
    { name: "claude", command: "node", args: [], rate_limit_patterns: ["rate limit"] },
    { name: "codex", command: "node", args: [], rate_limit_patterns: ["quota exceeded"] },
  ],
  primary: "claude",
  fallback_chain: ["claude", "codex"],
  healthcheck_interval_seconds: 1,
  backoff: { initial_seconds: 1, max_seconds: 4 },
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "swap-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Supervisor switch cycle", () => {
  it("claude rate-limited -> codex -> rate-limited -> backoff -> claude resumes", async () => {
    const store = new StateStore(tmpDir);
    store.ensure();

    // Track invocations to vary behavior across spawns.
    let claudeSpawns = 0;
    let codexSpawns = 0;

    const claudeMock = new MockProvider("claude", {
      available: true,
      events: [{ delayMs: 5, line: "Error: rate limit reached" }],
    });
    const codexMock = new MockProvider("codex", {
      available: false,
      events: [{ delayMs: 5, line: "Error: quota exceeded for current period" }],
    });

    const claudeWrapped: Provider = {
      name: "claude",
      spawn: (prompt, opts) => {
        claudeSpawns += 1;
        if (claudeSpawns === 1) {
          claudeMock.setBehavior({
            available: true,
            events: [
              { delayMs: 5, line: "claude run 1" },
              { delayMs: 5, line: "Error: rate limit hit" },
            ],
          });
        } else {
          claudeMock.setBehavior({
            available: true,
            events: [
              { delayMs: 5, line: "claude resumed" },
              { delayMs: 5, line: "task done" },
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
        codexSpawns += 1;
        codexMock.setBehavior({
          available: false,
          events: [
            { delayMs: 5, line: "codex run " + codexSpawns },
            { delayMs: 5, line: "Error: quota exceeded" },
          ],
        });
        return codexMock.spawn(prompt, opts);
      },
      isRateLimited: (l) => codexMock.isRateLimited(l),
      isAvailable: async () => codexMock.isAvailable(),
    };

    let sleeps = 0;

    const supervisor = new Supervisor({
      config: baseConfig,
      providers: new Map<string, Provider>([
        ["claude", claudeWrapped],
        ["codex", codexWrapped],
      ]),
      store,
      logger: silentLogger(),
      cwd: tmpDir,
      maxSwitches: 5,
      sleeper: async () => {
        sleeps += 1;
        // After the first sleep, mark claude available again for healthcheck.
        claudeMock.setBehavior({
          available: true,
          events: [
            { delayMs: 5, line: "claude resumed" },
            { delayMs: 5, line: "task done" },
          ],
        });
      },
    });

    const final = await supervisor.run({ taskPrompt: "long-running coding session" });

    expect(claudeSpawns).toBeGreaterThanOrEqual(2);
    expect(codexSpawns).toBeGreaterThanOrEqual(1);
    expect(sleeps).toBeGreaterThanOrEqual(1);
    expect(final.switch_count).toBeGreaterThanOrEqual(2);
    expect(final.current_provider).toBe("claude");

    const handoffPath = join(tmpDir, ".swap", "state", "HANDOFF.md");
    expect(existsSync(handoffPath)).toBe(true);
    const handoff = readFileSync(handoffPath, "utf8");
    expect(handoff).toContain("# Swap Handoff");

    const usagePath = join(tmpDir, ".swap", "state", "usage.jsonl");
    expect(existsSync(usagePath)).toBe(true);
    const usage = readFileSync(usagePath, "utf8").trim().split("\n");
    expect(usage.length).toBeGreaterThanOrEqual(3);

    const runPath = join(tmpDir, ".swap", "state", "run.json");
    expect(existsSync(runPath)).toBe(true);

    // Every swap should leave an archived handoff behind.
    const archiveDir = join(tmpDir, ".swap", "state", "handoffs");
    expect(existsSync(archiveDir)).toBe(true);
    const archived = readdirSync(archiveDir).filter((n) => n.endsWith(".md"));
    expect(archived.length).toBe(final.switch_count);
  });

  it("detects rate-limit phrases that wrap across lines", async () => {
    const store = new StateStore(tmpDir);
    store.ensure();

    // Pattern only matches when both lines are joined.
    const wrappedMock = new MockProvider(
      "claude",
      {
        available: true,
        events: [
          { delayMs: 5, line: "you have reached your weekly" },
          { delayMs: 5, line: "limit; try again next Monday" },
        ],
      },
      ["weekly\\s+limit"],
    );

    const claudeWrapped: Provider = {
      name: "claude",
      spawn: (p, o) => wrappedMock.spawn(p, o),
      isRateLimited: (l) => wrappedMock.isRateLimited(l),
      isAvailable: async () => wrappedMock.isAvailable(),
    };

    const codexMock = new MockProvider("codex", {
      available: true,
      events: [{ delayMs: 5, line: "codex took over" }],
    });
    const codexWrapped: Provider = {
      name: "codex",
      spawn: (p, o) => codexMock.spawn(p, o),
      isRateLimited: (l) => codexMock.isRateLimited(l),
      isAvailable: async () => codexMock.isAvailable(),
    };

    const supervisor = new Supervisor({
      config: baseConfig,
      providers: new Map<string, Provider>([
        ["claude", claudeWrapped],
        ["codex", codexWrapped],
      ]),
      store,
      logger: silentLogger(),
      cwd: tmpDir,
      maxSwitches: 2,
    });

    const final = await supervisor.run({ taskPrompt: "wrap test" });
    expect(final.switch_count).toBeGreaterThanOrEqual(1);
    expect(final.last_switch_reason).toMatch(/multi-line/);
  });

  it("exits cleanly when stop() is called", async () => {
    const store = new StateStore(tmpDir);
    store.ensure();

    const slowMock = new MockProvider("claude", {
      available: true,
      // Long-running output without rate limit
      events: Array.from({ length: 50 }, (_, i) => ({ delayMs: 20, line: `tick ${i}` })),
    });

    const wrapped: Provider = {
      name: "claude",
      spawn: (p, o) => slowMock.spawn(p, o),
      isRateLimited: (l) => slowMock.isRateLimited(l),
      isAvailable: async () => slowMock.isAvailable(),
    };

    const supervisor = new Supervisor({
      config: {
        ...baseConfig,
        fallback_chain: ["claude"],
      },
      providers: new Map<string, Provider>([["claude", wrapped]]),
      store,
      logger: silentLogger(),
      cwd: tmpDir,
      maxSwitches: 1,
    });

    const runPromise = supervisor.run({ taskPrompt: "stop me" });
    setTimeout(() => supervisor.stop(), 50);
    const final = await runPromise;
    expect(final.task_prompt).toBe("stop me");
  });
});
