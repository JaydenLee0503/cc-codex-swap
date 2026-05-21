import pino, { type Logger } from "pino";
import { StateStore } from "./state.js";

export function createLogger(store: StateStore, level: string = "info"): Logger {
  store.ensure();
  const transport = pino.multistream([
    { stream: process.stdout },
    {
      stream: {
        write(msg: string): void {
          try {
            store.appendLog(msg);
          } catch {
            // never crash on logging failures
          }
        },
      },
    },
  ]);
  return pino({ level, base: { app: "swap" } }, transport);
}
