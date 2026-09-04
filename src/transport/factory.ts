import type { Config } from "../config.js";
import { InMemoryChannel, InMemoryTransport } from "./memory.js";
import { DiscordTransport } from "./discord.js";
import type { TeamTransport } from "./transport.js";

/** Shared channel for the `memory` transport within one process (single-machine trials). */
let sharedMemoryChannel: InMemoryChannel | undefined;

export function createTransport(cfg: Config): TeamTransport {
  if (cfg.transport === "memory") {
    sharedMemoryChannel ??= new InMemoryChannel();
    return new InMemoryTransport(sharedMemoryChannel, { id: cfg.me, name: cfg.me });
  }
  return new DiscordTransport({
    token: cfg.discordToken ?? "",
    channelId: cfg.channelId,
  });
}
