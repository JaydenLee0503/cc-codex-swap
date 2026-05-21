#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig, defaultConfigYaml } from "./config.js";
import { StateStore } from "./state.js";
import { createLogger } from "./logger.js";
import { Supervisor } from "./supervisor.js";
import { buildProvider } from "./providers/index.js";
import { runDemo } from "./demo.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Provider } from "./types.js";

const program = new Command();
program
  .name("swap")
  .description("Supervisor that swaps between Claude Code and Codex CLI on rate-limit errors")
  .version("0.1.0");

program
  .command("start")
  .description("Start a new swap run for the given task prompt")
  .argument("<task...>", "task prompt to hand to the first provider")
  .option("--provider <name>", "override the initial provider (defaults to config.primary)")
  .action(async (taskWords: string[], opts: { provider?: string }) => {
    const taskPrompt = taskWords.join(" ");
    const cwd = process.cwd();
    const store = new StateStore(cwd);
    store.ensure();
    const logger = createLogger(store);
    const config = loadConfig(cwd);

    const providers = new Map<string, Provider>();
    for (const pcfg of config.providers) {
      providers.set(pcfg.name, buildProvider(pcfg));
    }

    const supervisor = new Supervisor({ config, providers, store, logger, cwd });
    store.writePid(process.pid);

    const shutdown = (sig: string): void => {
      logger.info({ sig }, "received signal, shutting down");
      supervisor.stop();
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    try {
      const final = await supervisor.run({
        taskPrompt,
        initialProvider: opts.provider,
      });
      logger.info(
        { switches: final.switch_count, current: final.current_provider },
        "swap run finished",
      );
    } catch (err) {
      logger.error({ err: String(err) }, "supervisor crashed");
      process.exitCode = 1;
    } finally {
      store.clearPid();
    }
  });

program
  .command("status")
  .description("Show current run status and usage estimates")
  .action(() => {
    const store = new StateStore();
    const run = store.readRun();
    if (!run) {
      process.stdout.write("no active swap run\n");
      return;
    }
    const usage = store.readUsage();
    const totals = aggregateUsage(usage);
    process.stdout.write(
      JSON.stringify(
        {
          current_provider: run.current_provider,
          switch_count: run.switch_count,
          start_time: run.start_time,
          last_switch_reason: run.last_switch_reason,
          providers_status: run.providers_status,
          pid: run.pid,
          usage_totals: totals,
        },
        null,
        2,
      ) + "\n",
    );
  });

program
  .command("stop")
  .description("Stop the currently running supervisor")
  .action(() => {
    const store = new StateStore();
    const pid = store.readPid();
    if (!pid) {
      process.stdout.write("no supervisor pid recorded\n");
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
      process.stdout.write(`sent SIGTERM to ${pid}\n`);
    } catch (err) {
      process.stdout.write(`failed to signal ${pid}: ${String(err)}\n`);
      process.exitCode = 1;
    }
  });

program
  .command("demo")
  .description("Run the full switching cycle against mocked CLIs")
  .action(async () => {
    const code = await runDemo();
    process.exit(code);
  });

program
  .command("init")
  .description("Write a default .swap/config.yaml")
  .action(() => {
    const cwd = process.cwd();
    const dir = resolve(cwd, ".swap");
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, "config.yaml");
    if (existsSync(path)) {
      process.stdout.write(`config already exists at ${path}\n`);
      return;
    }
    writeFileSync(path, defaultConfigYaml(), "utf8");
    process.stdout.write(`wrote default config to ${path}\n`);
  });

function aggregateUsage(records: { provider: string; chars_in: number; chars_out: number }[]): Record<string, { chars_in: number; chars_out: number }> {
  const out: Record<string, { chars_in: number; chars_out: number }> = {};
  for (const r of records) {
    if (!out[r.provider]) out[r.provider] = { chars_in: 0, chars_out: 0 };
    out[r.provider].chars_in += r.chars_in;
    out[r.provider].chars_out += r.chars_out;
  }
  return out;
}

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`swap: ${String(err)}\n`);
  process.exit(1);
});
