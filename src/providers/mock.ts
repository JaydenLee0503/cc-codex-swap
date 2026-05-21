import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { RateLimitDetector } from "../detector.js";
import type { Provider, SpawnOpts } from "../types.js";

export interface MockBehavior {
  // Sequence of events the mock will emit on stdout, one per line, with a delay.
  events: Array<{ delayMs: number; line: string }>;
  // Whether isAvailable() resolves true.
  available: boolean;
  // Optional exit code; default 0 after events drain.
  exitCode?: number;
}

export class MockProvider implements Provider {
  readonly name: string;
  private behavior: MockBehavior;
  private readonly detector: RateLimitDetector;

  constructor(name: string, behavior: MockBehavior, patterns: string[] = ["rate limit", "quota exceeded", "usage limit"]) {
    this.name = name;
    this.behavior = behavior;
    this.detector = new RateLimitDetector(patterns);
  }

  setBehavior(behavior: MockBehavior): void {
    this.behavior = behavior;
  }

  spawn(prompt: string, _opts: SpawnOpts): ChildProcess {
    const script = buildScript(this.behavior, prompt);
    const child = nodeSpawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    return child;
  }

  isRateLimited(line: string): boolean {
    return this.detector.test(line);
  }

  async isAvailable(): Promise<boolean> {
    return this.behavior.available;
  }
}

function buildScript(behavior: MockBehavior, prompt: string): string {
  const exit = behavior.exitCode ?? 0;
  const promptLen = prompt.length;
  const events = behavior.events.map((e) => ({ delayMs: e.delayMs, line: e.line }));
  const json = JSON.stringify({ events, exit, promptLen });
  return `
    const data = ${json};
    process.stdout.write('[mock] received prompt of ' + data.promptLen + ' chars\\n');
    let i = 0;
    const next = () => {
      if (i >= data.events.length) {
        process.exit(data.exit);
        return;
      }
      const ev = data.events[i++];
      setTimeout(() => {
        process.stdout.write(ev.line + '\\n');
        next();
      }, ev.delayMs);
    };
    next();
  `;
}
