import "./env.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig } from "./config.js";
import { log } from "./logger.js";
import { Relay } from "./relay.js";
import { createServer } from "./server.js";
import { Store } from "./state/store.js";
import { createTransport } from "./transport/factory.js";

export async function main(): Promise<void> {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      log.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (cfg.transport === "discord" && !cfg.discordToken) {
    log.error(
      "DISCORD_BOT_TOKEN is not set. Put it in .env, or the env block of your .mcp.json entry.",
    );
    process.exitCode = 1;
    return;
  }

  const transport = createTransport(cfg);
  const store = Store.open(cfg.configDir);
  const relay = new Relay(cfg, transport, store);

  try {
    await relay.connect();
  } catch (err) {
    log.error(`could not connect the ${cfg.transport} transport: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const server = createServer(cfg, relay);
  await server.connect(new StdioServerTransport());
  log.info(
    `team-relay ready — you are "${cfg.me}", channel has ${cfg.teammates.length} teammate(s)`,
  );

  const shutdown = () => {
    void relay.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** True when this file is the process entry (`node dist/index.js`), false when imported. */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err) => {
    log.error("fatal", err);
    process.exit(1);
  });
}
