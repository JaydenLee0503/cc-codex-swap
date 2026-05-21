import { execSync } from "node:child_process";
import type { RunState } from "./types.js";

export interface HandoffInput {
  taskPrompt: string;
  fromProvider: string;
  toProvider: string;
  reason: string;
  recentOutputTail: string[];
  cwd: string;
  runState?: RunState | null;
}

export function buildHandoff(input: HandoffInput): string {
  const gitLog = safeGit(["log", "--oneline", "-n", "20"], input.cwd);
  const gitStatus = safeGit(["status", "--short"], input.cwd);
  const nextSteps = extractNextSteps(input.recentOutputTail);

  const lines: string[] = [];
  lines.push(`# Swap Handoff`);
  lines.push("");
  lines.push(`- **From provider:** ${input.fromProvider}`);
  lines.push(`- **To provider:** ${input.toProvider}`);
  lines.push(`- **Reason:** ${input.reason}`);
  lines.push(`- **Timestamp:** ${new Date().toISOString()}`);
  if (input.runState) {
    lines.push(`- **Switch count:** ${input.runState.switch_count}`);
    lines.push(`- **Started:** ${input.runState.start_time}`);
  }
  lines.push("");
  lines.push(`## Original Task`);
  lines.push("");
  lines.push(input.taskPrompt.trim());
  lines.push("");
  lines.push(`## Recent Work (git log)`);
  lines.push("");
  lines.push("```");
  lines.push(gitLog.trim().length > 0 ? gitLog.trim() : "(no commits yet)");
  lines.push("```");
  lines.push("");
  lines.push(`## Files In Progress (git status)`);
  lines.push("");
  lines.push("```");
  lines.push(gitStatus.trim().length > 0 ? gitStatus.trim() : "(working tree clean)");
  lines.push("```");
  lines.push("");
  lines.push(`## Next Steps (from previous agent output)`);
  lines.push("");
  lines.push(nextSteps.length > 0 ? nextSteps.join("\n") : "(none captured)");
  lines.push("");
  lines.push(`## Resume Instructions`);
  lines.push("");
  lines.push(
    `You are picking up an autonomous coding session that was previously running on **${input.fromProvider}**. ` +
      `That provider hit a limit (${input.reason}). Continue the task above from the current repo state. ` +
      `When you finish a logical step, summarize what you did so that a future agent can pick up if you also get cut off.`,
  );
  lines.push("");
  return lines.join("\n");
}

function safeGit(args: string[], cwd: string): string {
  try {
    return execSync(`git ${args.map(shellQuote).join(" ")}`, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
  } catch {
    return "";
  }
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./=-]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

const NEXT_STEPS_RE = /^(next steps?|todo|next:)/i;

function extractNextSteps(lines: string[]): string[] {
  const out: string[] = [];
  let capture = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (NEXT_STEPS_RE.test(line)) {
      capture = true;
      out.push(line);
      continue;
    }
    if (capture) {
      if (line.length === 0) {
        if (out.length > 0) break;
        continue;
      }
      if (/^[-*\d]/.test(line) || line.length < 200) {
        out.push(line);
      } else {
        break;
      }
    }
  }
  return out.slice(0, 30);
}
