import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { RateLimitDetector } from "../detector.js";
import type { Provider, ProviderConfig, SpawnOpts } from "../types.js";

export class CodexProvider implements Provider {
  readonly name = "codex";
  private readonly detector: RateLimitDetector;

  constructor(private readonly cfg: ProviderConfig) {
    this.detector = new RateLimitDetector(cfg.rate_limit_patterns);
  }

  spawn(prompt: string, opts: SpawnOpts): ChildProcess {
    const child = nodeSpawn(this.cfg.command, this.cfg.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    if (child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }
    return child;
  }

  isRateLimited(line: string): boolean {
    return this.detector.test(line);
  }

  async isAvailable(): Promise<boolean> {
    const command = this.cfg.status_check?.command ?? this.cfg.command;
    const args = this.cfg.status_check?.args ?? ["--version"];
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      try {
        const child = nodeSpawn(command, args, {
          stdio: ["ignore", "ignore", "ignore"],
          shell: false,
        });
        child.on("error", () => done(false));
        child.on("exit", (code) => done(code === 0));
        setTimeout(() => {
          try {
            child.kill();
          } catch {
            // ignore
          }
          done(false);
        }, 5000);
      } catch {
        done(false);
      }
    });
  }
}
