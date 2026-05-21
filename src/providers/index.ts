import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import type { Provider, ProviderConfig } from "../types.js";

export function buildProvider(cfg: ProviderConfig): Provider {
  switch (cfg.name) {
    case "claude":
      return new ClaudeProvider(cfg);
    case "codex":
      return new CodexProvider(cfg);
    default:
      // Generic claude-style adapter for unknown providers
      return new ClaudeProvider({ ...cfg, name: cfg.name });
  }
}

export { ClaudeProvider, CodexProvider };
export { MockProvider } from "./mock.js";
