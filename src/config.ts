import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { SwapConfig } from "./types.js";

const ProviderConfigSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  rate_limit_patterns: z.array(z.string()).default([]),
  status_check: z
    .object({
      command: z.string(),
      args: z.array(z.string()).default([]),
    })
    .optional(),
});

const BackoffSchema = z.object({
  initial_seconds: z.number().int().positive().default(60),
  max_seconds: z.number().int().positive().default(3600),
});

const SwapConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema).min(1),
  primary: z.string().min(1),
  fallback_chain: z.array(z.string()).min(1),
  healthcheck_interval_seconds: z.number().int().positive().default(300),
  backoff: BackoffSchema.default({ initial_seconds: 60, max_seconds: 3600 }),
});

export const DEFAULT_CONFIG: SwapConfig = {
  providers: [
    {
      name: "claude",
      command: "claude",
      args: [],
      rate_limit_patterns: [
        "rate limit",
        "you've reached your weekly",
        "5-hour limit",
        "usage limit",
      ],
    },
    {
      name: "codex",
      command: "codex",
      args: ["--full-auto"],
      rate_limit_patterns: ["quota exceeded", "usage limit", "rate limit"],
    },
  ],
  primary: "claude",
  fallback_chain: ["claude", "codex"],
  healthcheck_interval_seconds: 300,
  backoff: { initial_seconds: 60, max_seconds: 3600 },
};

export function loadConfig(cwd: string = process.cwd()): SwapConfig {
  const path = resolve(cwd, ".swap", "config.yaml");
  if (!existsSync(path)) {
    return DEFAULT_CONFIG;
  }
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = YAML.parse(raw);
  const validated = SwapConfigSchema.parse(parsed);

  for (const name of validated.fallback_chain) {
    if (!validated.providers.find((p) => p.name === name)) {
      throw new Error(`fallback_chain references unknown provider: ${name}`);
    }
  }
  if (!validated.providers.find((p) => p.name === validated.primary)) {
    throw new Error(`primary references unknown provider: ${validated.primary}`);
  }
  return validated;
}

export function defaultConfigYaml(): string {
  return YAML.stringify(DEFAULT_CONFIG);
}
