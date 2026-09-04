import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { resolveConfigDir, teamFilePath, type TeamFile } from "../config.js";
import { nameKey } from "../core/types.js";
import { probeAuth, restClient } from "./discord-probe.js";
import { Prompt } from "./prompt.js";

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const SNOWFLAKE_RE = /^\d{15,25}$/;

export async function runInit(cwd = process.cwd()): Promise<number> {
  const p = new Prompt();
  try {
    console.log("team-relay-mcp setup\n");
    console.log(
      "You'll need a Discord bot of your own (each teammate runs their own so message\n" +
        "authorship can be verified) and the shared channel's id. See the README, section 1.\n",
    );

    const configDir = process.env.TEAM_RELAY_CONFIG_DIR
      ? resolve(cwd, process.env.TEAM_RELAY_CONFIG_DIR)
      : join(cwd, ".team-relay");
    const teamPath = teamFilePath(configDir);
    if (
      existsSync(teamPath) &&
      !(await p.confirm(`${rel(cwd, teamPath)} exists. Overwrite?`, false))
    ) {
      console.log("Keeping the existing config.");
      return 0;
    }

    let me = await p.text("Your name (lowercase, unique in the team, e.g. alice)", {
      required: true,
    });
    while (!NAME_RE.test(me)) {
      me = await p.text("  use letters/digits/-/_ only", { required: true });
    }
    me = me.toLowerCase();

    const token = await p.text("Your Discord bot token", { required: true });
    const channelId = await p.text("Shared channel id", { required: true });

    console.log("\nChecking the token...");
    const auth = await probeAuth(restClient(token));
    if (!auth.ok || !auth.userId) {
      console.error(`  ${auth.detail}`);
      console.error("  Fix the token and re-run `team-relay-mcp init`.");
      return 1;
    }
    console.log(`  ${auth.detail}`);
    console.log(`\n  >> Your bot's user id is ${auth.userId}`);
    console.log("  >> Share that id with your teammates, and collect theirs.\n");

    const teammates: TeamFile["teammates"] = [{ name: me, id: auth.userId }];
    console.log("Now add your teammates. Enter a blank name when done.");
    for (;;) {
      const tName = (await p.text("  teammate name")).toLowerCase();
      if (!tName) break;
      if (!NAME_RE.test(tName)) {
        console.log("    invalid name, skipped");
        continue;
      }
      if (teammates.some((t) => nameKey(t.name) === nameKey(tName))) {
        console.log("    already added, skipped");
        continue;
      }
      const tId = await p.text(`  ${tName}'s bot user id`, { required: true });
      if (!SNOWFLAKE_RE.test(tId)) {
        console.log("    that doesn't look like a Discord id, skipped");
        continue;
      }
      teammates.push({ name: tName, id: tId });
    }

    if (teammates.length < 2) {
      console.log("\nNo teammates added yet — you can edit team.json later to add them.");
    }

    const team: TeamFile = {
      me,
      channelId,
      teammates,
      decisionsFile: "TEAM-DECISIONS.md",
      transport: "discord",
    };

    mkdirSync(configDir, { recursive: true });
    writeFileSync(teamPath, `${JSON.stringify(team, null, 2)}\n`, "utf8");
    writeFileSync(join(configDir, ".env"), `DISCORD_BOT_TOKEN=${token}\n`, "utf8");
    console.log(`\nWrote ${rel(cwd, teamPath)} and ${rel(cwd, join(configDir, ".env"))}.`);

    const mcpEntry = {
      mcpServers: {
        "team-relay": {
          command: "npx",
          args: ["-y", "team-relay-mcp"],
          env: { TEAM_RELAY_CONFIG_DIR: rel(cwd, configDir) || "." },
        },
      },
    };
    console.log("\nAdd this to your project's .mcp.json:\n");
    console.log(JSON.stringify(mcpEntry, null, 2));

    if (await p.confirm("\nAppend the CLAUDE.md guidance snippet now?")) {
      appendClaudeMd(cwd);
    }

    console.log(
      "\nNext: run `team-relay-mcp doctor` to verify the connection, then restart Claude Code.",
    );
    return 0;
  } finally {
    p.close();
  }
}

function appendClaudeMd(cwd: string): void {
  const snippetPath = new URL("../../docs/claude-md-snippet.md", import.meta.url);
  let snippet: string;
  try {
    snippet = readFileSync(snippetPath, "utf8");
  } catch {
    console.log("  (couldn't find the snippet file; copy docs/claude-md-snippet.md manually)");
    return;
  }
  const target = join(cwd, "CLAUDE.md");
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (existing.includes("team-relay")) {
    console.log("  CLAUDE.md already mentions team-relay; skipped.");
    return;
  }
  writeFileSync(target, existing ? `${existing.trimEnd()}\n\n${snippet}` : snippet, "utf8");
  console.log(`  Appended to ${rel(cwd, target)}.`);
}

function rel(from: string, to: string): string {
  const r = relative(from, to);
  return r.startsWith("..") ? to : r.split("\\").join("/");
}
