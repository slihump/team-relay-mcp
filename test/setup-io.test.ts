import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TeamFile } from "../src/config.js";
import { appendClaudeMd, mcpEntry, relPath, writeTeamFiles } from "../src/cli/setup-io.js";

const TEAM: TeamFile = {
  me: "alice",
  channelId: "1546378169722994720",
  teammates: [{ name: "alice", id: "1546373827578167447" }],
  decisionsFile: "TEAM-DECISIONS.md",
  transport: "discord",
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "team-relay-setup-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("writeTeamFiles", () => {
  it("writes team.json and .env, creating the directory", () => {
    const cfg = join(dir, ".team-relay");
    const { teamPath, envPath } = writeTeamFiles(cfg, TEAM, "tok-123");

    expect(JSON.parse(readFileSync(teamPath, "utf8"))).toEqual(TEAM);
    expect(readFileSync(envPath, "utf8")).toBe("DISCORD_BOT_TOKEN=tok-123\n");
  });

  it("keeps the token file private", () => {
    const cfg = join(dir, ".team-relay");
    const { envPath } = writeTeamFiles(cfg, TEAM, "tok-123");
    if (process.platform === "win32") return; // POSIX modes only
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it("tightens the mode even when .env already exists loosely", () => {
    const cfg = join(dir, ".team-relay");
    writeTeamFiles(cfg, TEAM, "first");
    writeFileSync(join(cfg, ".env"), "DISCORD_BOT_TOKEN=stale\n", { mode: 0o644 });

    const { envPath } = writeTeamFiles(cfg, TEAM, "second");
    expect(readFileSync(envPath, "utf8")).toBe("DISCORD_BOT_TOKEN=second\n");
    if (process.platform === "win32") return;
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
  });
});

describe("mcpEntry", () => {
  it("points TEAM_RELAY_CONFIG_DIR at the config dir, relative to cwd", () => {
    expect(mcpEntry("/repo", "/repo/.team-relay")).toEqual({
      mcpServers: {
        "team-relay": {
          command: "npx",
          args: ["-y", "team-relay-mcp"],
          env: { TEAM_RELAY_CONFIG_DIR: ".team-relay" },
        },
      },
    });
  });

  it("falls back to '.' when the config dir is the cwd", () => {
    const entry = mcpEntry("/repo", "/repo") as {
      mcpServers: { "team-relay": { env: { TEAM_RELAY_CONFIG_DIR: string } } };
    };
    expect(entry.mcpServers["team-relay"].env.TEAM_RELAY_CONFIG_DIR).toBe(".");
  });
});

describe("relPath", () => {
  it("uses forward slashes and keeps absolute paths that escape cwd", () => {
    expect(relPath("/repo", "/repo/a/b")).toBe("a/b");
    expect(relPath("/repo", "/elsewhere")).toBe("/elsewhere");
  });
});

describe("appendClaudeMd", () => {
  it("creates CLAUDE.md when absent", () => {
    expect(appendClaudeMd(dir)).toBe("appended");
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain("team-relay");
  });

  it("does not append twice", () => {
    appendClaudeMd(dir);
    expect(appendClaudeMd(dir)).toBe("already-present");
  });
});
