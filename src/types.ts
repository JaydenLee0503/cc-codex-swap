import type { ChildProcess } from "node:child_process";

export interface SpawnOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface Provider {
  readonly name: string;
  spawn(prompt: string, opts: SpawnOpts): ChildProcess;
  isRateLimited(line: string): boolean;
  isAvailable(): Promise<boolean>;
}

export interface ProviderStatus {
  available: boolean;
  lastCheck: string;
  lastRateLimitAt: string | null;
}

export interface RunState {
  current_provider: string;
  task_prompt: string;
  start_time: string;
  switch_count: number;
  last_switch_reason: string | null;
  providers_status: Record<string, ProviderStatus>;
  pid?: number;
}

export interface UsageRecord {
  ts: string;
  provider: string;
  chars_in: number;
  chars_out: number;
}

export interface ProviderConfig {
  name: string;
  command: string;
  args: string[];
  rate_limit_patterns: string[];
  status_check?: {
    command: string;
    args: string[];
  };
}

export interface BackoffConfig {
  initial_seconds: number;
  max_seconds: number;
}

export interface SwapConfig {
  providers: ProviderConfig[];
  primary: string;
  fallback_chain: string[];
  healthcheck_interval_seconds: number;
  backoff: BackoffConfig;
}
