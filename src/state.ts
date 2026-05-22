import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  statSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import type { RunState, UsageRecord } from "./types.js";

const LOG_ROTATE_BYTES = 10 * 1024 * 1024;

export class StateStore {
  readonly dir: string;
  readonly runPath: string;
  readonly handoffPath: string;
  readonly handoffArchiveDir: string;
  readonly usagePath: string;
  readonly logPath: string;
  readonly pidPath: string;

  constructor(cwd: string = process.cwd()) {
    this.dir = resolve(cwd, ".swap", "state");
    this.runPath = join(this.dir, "run.json");
    this.handoffPath = join(this.dir, "HANDOFF.md");
    this.handoffArchiveDir = join(this.dir, "handoffs");
    this.usagePath = join(this.dir, "usage.jsonl");
    this.logPath = join(this.dir, "swap.log");
    this.pidPath = join(this.dir, "swap.pid");
  }

  ensure(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  readRun(): RunState | null {
    if (!existsSync(this.runPath)) return null;
    try {
      const raw = readFileSync(this.runPath, "utf8");
      return JSON.parse(raw) as RunState;
    } catch {
      return null;
    }
  }

  writeRun(state: RunState): void {
    this.ensure();
    writeFileSync(this.runPath, JSON.stringify(state, null, 2), "utf8");
  }

  clearRun(): void {
    if (existsSync(this.runPath)) unlinkSync(this.runPath);
  }

  writePid(pid: number): void {
    this.ensure();
    writeFileSync(this.pidPath, String(pid), "utf8");
  }

  readPid(): number | null {
    if (!existsSync(this.pidPath)) return null;
    const raw = readFileSync(this.pidPath, "utf8").trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  clearPid(): void {
    if (existsSync(this.pidPath)) unlinkSync(this.pidPath);
  }

  appendUsage(record: UsageRecord): void {
    this.ensure();
    appendFileSync(this.usagePath, JSON.stringify(record) + "\n", "utf8");
  }

  readUsage(): UsageRecord[] {
    if (!existsSync(this.usagePath)) return [];
    const raw = readFileSync(this.usagePath, "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as UsageRecord);
  }

  writeHandoff(content: string): void {
    this.ensure();
    writeFileSync(this.handoffPath, content, "utf8");
  }

  archiveHandoff(content: string, fromProvider: string, toProvider: string): string {
    this.ensure();
    mkdirSync(this.handoffArchiveDir, { recursive: true });
    // Colon is illegal in Windows filenames; use a filesystem-safe ISO variant.
    const ts = new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "");
    const safeFrom = sanitizeSegment(fromProvider);
    const safeTo = sanitizeSegment(toProvider);
    const path = join(this.handoffArchiveDir, `${ts}-${safeFrom}-to-${safeTo}.md`);
    writeFileSync(path, content, "utf8");
    return path;
  }

  readHandoff(): string | null {
    if (!existsSync(this.handoffPath)) return null;
    return readFileSync(this.handoffPath, "utf8");
  }

  appendLog(line: string): void {
    this.ensure();
    this.rotateLogIfNeeded();
    appendFileSync(this.logPath, line.endsWith("\n") ? line : line + "\n", "utf8");
  }

  private rotateLogIfNeeded(): void {
    if (!existsSync(this.logPath)) return;
    try {
      const s = statSync(this.logPath);
      if (s.size >= LOG_ROTATE_BYTES) {
        const rotated = `${this.logPath}.${Date.now()}`;
        renameSync(this.logPath, rotated);
      }
    } catch {
      // ignore rotation failures
    }
  }
}

function sanitizeSegment(s: string): string {
  const cleaned = s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40);
  return cleaned.length > 0 ? cleaned : "unknown";
}
