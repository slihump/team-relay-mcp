import { ConfigError, loadConfig } from "../config.js";
import { nameKey } from "../core/types.js";
import { probeAuth, probeChannel, probeReadHistory, restClient } from "./discord-probe.js";

const OK = "  ok  ";
const BAD = " FAIL ";
const WARN = " warn ";

export async function runDoctor(cwd = process.cwd()): Promise<number> {
  let failed = false;
  const line = (tag: string, msg: string) => console.log(`[${tag}] ${msg}`);

  let cfg;
  try {
    cfg = loadConfig({ cwd });
  } catch (err) {
    if (err instanceof ConfigError) {
      line(BAD, err.message.split("\n")[0] ?? err.message);
      console.log("\nRun `team-relay-mcp init` first.");
      return 1;
    }
    throw err;
  }

  line(
    OK,
    `config: you are "${cfg.me}", ${cfg.teammates.length} teammate(s), transport=${cfg.transport}`,
  );

  // roster sanity
  const keys = cfg.teammates.map((t) => nameKey(t.name));
  if (new Set(keys).size !== keys.length) {
    line(BAD, "roster has duplicate names");
    failed = true;
  }
  if (!keys.includes(nameKey(cfg.me))) {
    line(BAD, `"me" (${cfg.me}) is not in the roster`);
    failed = true;
  }
  const others = cfg.teammates.filter((t) => nameKey(t.name) !== nameKey(cfg.me));
  if (others.length === 0) {
    line(WARN, "no teammates besides you — add them to team.json");
  }

  if (cfg.transport === "memory") {
    line(OK, "transport=memory: nothing else to check");
    return failed ? 1 : 0;
  }

  if (!cfg.discordToken) {
    line(
      BAD,
      "DISCORD_BOT_TOKEN is not set (put it in .team-relay/.env or your .mcp.json env block)",
    );
    return 1;
  }

  const rest = restClient(cfg.discordToken);

  const auth = await probeAuth(rest);
  line(auth.ok ? OK : BAD, auth.detail);
  if (!auth.ok) return 1;

  const myEntry = cfg.teammates.find((t) => nameKey(t.name) === nameKey(cfg.me));
  if (myEntry && auth.userId && myEntry.id !== auth.userId) {
    line(
      BAD,
      `your roster id (${myEntry.id}) does not match this bot's id (${auth.userId}). ` +
        "Teammates will drop your messages. Fix your entry in team.json.",
    );
    failed = true;
  }

  const channel = await probeChannel(rest, cfg.channelId);
  line(channel.ok ? OK : BAD, channel.detail);
  if (!channel.ok) failed = true;

  const history = await probeReadHistory(rest, cfg.channelId);
  line(history.ok ? OK : BAD, history.detail);
  if (!history.ok) failed = true;

  line(
    WARN,
    'make sure the bot\'s "Message Content" intent is ON in the Developer Portal — ' +
      "without it you cannot read teammates' messages",
  );

  console.log(failed ? "\nSome checks failed. See above." : "\nAll checks passed.");
  return failed ? 1 : 0;
}
