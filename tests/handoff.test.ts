import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHandoff } from "../src/handoff.js";

function withTempDir(setup: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "swap-handoff-"));
  setup(dir);
  return dir;
}

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

  it("includes CLAUDE.md and AGENTS.md when present in cwd", () => {
    const dir = withTempDir((d) => {
      writeFileSync(join(d, "CLAUDE.md"), "# Project brief for Claude\nUse pino logger.\n");
      writeFileSync(join(d, "AGENTS.md"), "# Project brief for Codex\nUse pino logger.\n");
    });
    try {
      const md = buildHandoff({
        taskPrompt: "task",
        fromProvider: "a",
        toProvider: "b",
        reason: "x",
        recentOutputTail: [],
        cwd: dir,
      });
      expect(md).toContain("## Project Brief");
      expect(md).toContain("### CLAUDE.md");
      expect(md).toContain("### AGENTS.md");
      expect(md).toContain("Project brief for Claude");
      expect(md).toContain("Project brief for Codex");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dedupes identical CLAUDE.md and AGENTS.md", () => {
    const identical = "# Same brief\nKeep them in sync.\n";
    const dir = withTempDir((d) => {
      writeFileSync(join(d, "CLAUDE.md"), identical);
      writeFileSync(join(d, "AGENTS.md"), identical);
    });
    try {
      const md = buildHandoff({
        taskPrompt: "task",
        fromProvider: "a",
        toProvider: "b",
        reason: "x",
        recentOutputTail: [],
        cwd: dir,
      });
      expect(md).toContain("### CLAUDE.md");
      expect(md).not.toContain("### AGENTS.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("omits the Project Brief section when no briefs exist", () => {
    const dir = withTempDir(() => {
      // intentionally empty
    });
    try {
      const md = buildHandoff({
        taskPrompt: "task",
        fromProvider: "a",
        toProvider: "b",
        reason: "x",
        recentOutputTail: [],
        cwd: dir,
      });
      expect(md).not.toContain("## Project Brief");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("truncates briefs larger than the handoff budget", () => {
    const huge = "x".repeat(20 * 1024);
    const dir = withTempDir((d) => {
      writeFileSync(join(d, "CLAUDE.md"), huge);
    });
    try {
      const md = buildHandoff({
        taskPrompt: "task",
        fromProvider: "a",
        toProvider: "b",
        reason: "x",
        recentOutputTail: [],
        cwd: dir,
      });
      expect(md).toContain("### CLAUDE.md");
      expect(md).toContain("truncated to fit handoff budget");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
