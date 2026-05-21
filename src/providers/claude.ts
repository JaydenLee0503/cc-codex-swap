import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { RateLimitDetector } from "../detector.js";
import type { Provider, ProviderConfig, SpawnOpts } from "../types.js";

export class ClaudeProvider implements Provider {
  readonly name = "claude";
  private readonly detector: RateLimitDetector;

  constructor(private readonly cfg: ProviderConfig) {
    this.detector = new RateLimitDetector(cfg.rate_limit_patterns);
  }

  spawn(prompt: string, opts: SpawnOpts): ChildProcess {
    const args = [...this.cfg.args, "-p", prompt];
    return nodeSpawn(this.cfg.command, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
  }

  isRateLimited(line: string): boolean {
    return this.detector.test(line);
  }

  async isAvailable(): Promise<boolean> {
    return runStatusCheck(this.cfg.status_check?.command ?? this.cfg.command, [
      ...(this.cfg.status_check?.args ?? ["--version"]),
    ]);
  }
}

async function runStatusCheck(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = nodeSpawn(command, args, {
        stdio: ["ignore", "ignore", "ignore"],
        shell: false,
      });
      child.on("error", () => finish(false));
      child.on("exit", (code) => finish(code === 0));
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore
        }
        finish(false);
      }, 5000);
    } catch {
      finish(false);
    }
  });
}
