import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { teamFilePath, type TeamFile } from "../config.js";

/** Where setup writes, honouring TEAM_RELAY_CONFIG_DIR the same way the server reads it. */
export function resolveSetupDir(cwd: string): string {
  return process.env.TEAM_RELAY_CONFIG_DIR
    ? resolve(cwd, process.env.TEAM_RELAY_CONFIG_DIR)
    : join(cwd, ".team-relay");
}

/**
 * Write both setup files. `.env` holds a bot token, so it is created — and
 * re-tightened, in case it already existed with a looser mode — as 0600.
 */
export function writeTeamFiles(
  configDir: string,
  team: TeamFile,
  token: string,
): { teamPath: string; envPath: string } {
  mkdirSync(configDir, { recursive: true });
  const teamPath = teamFilePath(configDir);
  const envPath = join(configDir, ".env");

  writeFileSync(teamPath, `${JSON.stringify(team, null, 2)}\n`, "utf8");
  writeFileSync(envPath, `DISCORD_BOT_TOKEN=${token}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // Windows and some mounts do not support POSIX modes; the content is still written.
  }
  return { teamPath, envPath };
}

export function mcpEntry(cwd: string, configDir: string): object {
  return {
    mcpServers: {
      "team-relay": {
        command: "npx",
        args: ["-y", "team-relay-mcp"],
        env: { TEAM_RELAY_CONFIG_DIR: relPath(cwd, configDir) || "." },
      },
    },
  };
}

export function appendClaudeMd(cwd: string): "appended" | "already-present" | "snippet-missing" {
  let snippet: string;
  try {
    snippet = readFileSync(new URL("../../docs/claude-md-snippet.md", import.meta.url), "utf8");
  } catch {
    return "snippet-missing";
  }
  const target = join(cwd, "CLAUDE.md");
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (existing.includes("team-relay")) return "already-present";
  writeFileSync(target, existing ? `${existing.trimEnd()}\n\n${snippet}` : snippet, "utf8");
  return "appended";
}

export function relPath(from: string, to: string): string {
  const r = relative(from, to);
  return r.startsWith("..") ? to : r.split("\\").join("/");
}
