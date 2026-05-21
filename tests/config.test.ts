import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, defaultConfigYaml, DEFAULT_CONFIG } from "../src/config.js";

describe("loadConfig", () => {
  it("returns DEFAULT_CONFIG when no file present", () => {
    const dir = mkdtempSync(join(tmpdir(), "swap-cfg-"));
    try {
      const cfg = loadConfig(dir);
      expect(cfg).toEqual(DEFAULT_CONFIG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses a valid YAML config", () => {
    const dir = mkdtempSync(join(tmpdir(), "swap-cfg-"));
    try {
      mkdirSync(join(dir, ".swap"), { recursive: true });
      writeFileSync(join(dir, ".swap", "config.yaml"), defaultConfigYaml(), "utf8");
      const cfg = loadConfig(dir);
      expect(cfg.primary).toBe("claude");
      expect(cfg.fallback_chain).toEqual(["claude", "codex"]);
      expect(cfg.providers.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a fallback_chain referencing unknown provider", () => {
    const dir = mkdtempSync(join(tmpdir(), "swap-cfg-"));
    try {
      mkdirSync(join(dir, ".swap"), { recursive: true });
      const yaml = `
providers:
  - name: claude
    command: claude
    args: []
    rate_limit_patterns: ["rate limit"]
primary: claude
fallback_chain: [claude, ghost]
healthcheck_interval_seconds: 60
backoff:
  initial_seconds: 60
  max_seconds: 3600
`;
      writeFileSync(join(dir, ".swap", "config.yaml"), yaml, "utf8");
      expect(() => loadConfig(dir)).toThrow(/unknown provider: ghost/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
