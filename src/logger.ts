/**
 * Diagnostics go to stderr ONLY.
 *
 * This process speaks JSON-RPC over stdout (MCP stdio transport). Anything
 * written to stdout that is not a protocol message corrupts the stream, so
 * every log line here uses `console.error`.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = LEVELS[(process.env.TEAM_RELAY_LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;

function emit(level: Level, msg: string, extra?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const prefix = `[team-relay] ${level}:`;
  if (extra === undefined) {
    console.error(prefix, msg);
  } else {
    console.error(prefix, msg, extra);
  }
}

export const log = {
  debug: (msg: string, extra?: unknown) => emit("debug", msg, extra),
  info: (msg: string, extra?: unknown) => emit("info", msg, extra),
  warn: (msg: string, extra?: unknown) => emit("warn", msg, extra),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra),
};
