import type { REST } from "@discordjs/rest";
import { existsSync } from "node:fs";
import { teamFilePath, type TeamFile } from "../config.js";
import { nameKey } from "../core/types.js";
import { probeAuth, probeChannel, probeGuildTextChannels, restClient } from "./discord-probe.js";
import { Prompt } from "./prompt.js";
import { appendClaudeMd, mcpEntry, relPath, resolveSetupDir, writeTeamFiles } from "./setup-io.js";

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

    const configDir = resolveSetupDir(cwd);
    const teamPath = teamFilePath(configDir);
    if (
      existsSync(teamPath) &&
      !(await p.confirm(`${relPath(cwd, teamPath)} exists. Overwrite?`, false))
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

    console.log("\nChecking the token...");
    const rest = restClient(token);
    const auth = await probeAuth(rest);
    if (!auth.ok || !auth.userId) {
      console.error(`  ${auth.detail}`);
      console.error("  Fix the token and re-run `team-relay-mcp init`.");
      return 1;
    }
    console.log(`  ${auth.detail}\n`);

    const channelId = await askChannelId(p, rest);
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

    const { teamPath: written, envPath } = writeTeamFiles(configDir, team, token);
    console.log(`\nWrote ${relPath(cwd, written)} and ${relPath(cwd, envPath)}.`);

    console.log("\nAdd this to your project's .mcp.json:\n");
    console.log(JSON.stringify(mcpEntry(cwd, configDir), null, 2));

    if (await p.confirm("\nAppend the CLAUDE.md guidance snippet now?")) {
      const result = appendClaudeMd(cwd);
      if (result === "appended") console.log("  Appended to CLAUDE.md.");
      else if (result === "already-present")
        console.log("  CLAUDE.md already mentions team-relay; skipped.");
      else console.log("  (couldn't find the snippet; copy docs/claude-md-snippet.md manually)");
    }

    console.log(
      "\nNext: run `team-relay-mcp doctor` to verify the connection, then restart Claude Code.",
    );
    return 0;
  } finally {
    p.close();
  }
}

/**
 * Ask for the channel id until it resolves. The id is never validated later —
 * `team.json` takes any string so the `memory` transport can ignore it — so a
 * wrong value would otherwise surface much later as a bare 404 from `doctor`.
 */
async function askChannelId(p: Prompt, rest: REST): Promise<string> {
  for (;;) {
    const id = await p.text("Shared channel id", { required: true });

    if (!SNOWFLAKE_RE.test(id)) {
      console.log("  That is not a Discord id (expected 15-25 digits).");
      console.log("  Enable Developer Mode, then right-click the channel > Copy Channel ID.\n");
      continue;
    }

    const channel = await probeChannel(rest, id);
    if (channel.ok) {
      console.log(`  ${channel.detail}\n`);
      return id;
    }

    const guild = await probeGuildTextChannels(rest, id);
    if (guild.isGuild) {
      console.log(`  That is the *server* id (${guild.name ?? id}), not a channel id.`);
      if (guild.channels.length > 0) {
        console.log("  Text channels in it:");
        for (const c of guild.channels) console.log(`    ${c.id}  #${c.name}`);
      }
      console.log("");
      continue;
    }

    console.log(`  ${channel.detail}`);
    console.log("  Check the id, and that the bot was invited to that server.\n");
    if (await p.confirm("  Use it anyway?", false)) return id;
  }
}
