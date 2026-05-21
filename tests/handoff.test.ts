import { describe, it, expect } from "vitest";
import { buildHandoff } from "../src/handoff.js";

describe("buildHandoff", () => {
  it("includes provider names, reason, task, and metadata", () => {
    const md = buildHandoff({
      taskPrompt: "Refactor the auth module to use JWT",
      fromProvider: "claude",
      toProvider: "codex",
      reason: "rate limit detected",
      recentOutputTail: ["editing src/auth.ts", "Next steps:", "- finish JWT validation", "- add tests"],
      cwd: process.cwd(),
      runState: {
        current_provider: "claude",
        task_prompt: "Refactor the auth module to use JWT",
        start_time: "2026-05-21T00:00:00Z",
        switch_count: 1,
        last_switch_reason: null,
        providers_status: {},
      },
    });

    expect(md).toContain("# Swap Handoff");
    expect(md).toContain("**From provider:** claude");
    expect(md).toContain("**To provider:** codex");
    expect(md).toContain("**Reason:** rate limit detected");
    expect(md).toContain("Refactor the auth module to use JWT");
    expect(md).toContain("**Switch count:** 1");
    expect(md).toContain("Recent Work (git log)");
    expect(md).toContain("Files In Progress (git status)");
    expect(md).toContain("Resume Instructions");
  });

  it("captures next-steps lines from recent output", () => {
    const md = buildHandoff({
      taskPrompt: "task",
      fromProvider: "a",
      toProvider: "b",
      reason: "x",
      recentOutputTail: [
        "doing work",
        "Next steps:",
        "- step one",
        "- step two",
        "",
        "afterwards stuff",
      ],
      cwd: process.cwd(),
    });
    expect(md).toContain("Next steps:");
    expect(md).toContain("- step one");
    expect(md).toContain("- step two");
  });

  it("falls back when no next steps captured", () => {
    const md = buildHandoff({
      taskPrompt: "task",
      fromProvider: "a",
      toProvider: "b",
      reason: "x",
      recentOutputTail: ["just doing work", "nothing fancy"],
      cwd: process.cwd(),
    });
    expect(md).toContain("(none captured)");
  });
});
