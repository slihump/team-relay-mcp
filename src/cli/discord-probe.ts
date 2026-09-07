import { REST } from "@discordjs/rest";
import { type APIChannel, type APIUser, ChannelType, Routes } from "discord-api-types/v10";

export interface Probe {
  ok: boolean;
  detail: string;
}

export function restClient(token: string): REST {
  return new REST({ version: "10" }).setToken(token);
}

export async function probeAuth(
  rest: REST,
): Promise<Probe & { userId?: string; username?: string }> {
  try {
    const me = (await rest.get(Routes.user("@me"))) as APIUser;
    return {
      ok: true,
      detail: `authenticated as ${me.username} (${me.id})`,
      userId: me.id,
      username: me.username,
    };
  } catch (err) {
    return { ok: false, detail: `auth failed — check the token (${message(err)})` };
  }
}

export async function probeChannel(
  rest: REST,
  channelId: string,
): Promise<Probe & { name?: string }> {
  try {
    const ch = (await rest.get(Routes.channel(channelId))) as APIChannel & { name?: string };
    return { ok: true, detail: `channel found: #${ch.name ?? channelId}`, name: ch.name };
  } catch (err) {
    return { ok: false, detail: `cannot see channel ${channelId} (${message(err)})` };
  }
}

export async function probeReadHistory(rest: REST, channelId: string): Promise<Probe> {
  try {
    await rest.get(Routes.channelMessages(channelId), {
      query: new URLSearchParams({ limit: "1" }),
    });
    return { ok: true, detail: "can read message history" };
  } catch (err) {
    return {
      ok: false,
      detail: `cannot read message history — grant View Channel + Read Message History (${message(err)})`,
    };
  }
}

/**
 * Is this id a guild the bot is in? Pasting the server id instead of the channel
 * id is the easiest mistake to make — both are snowflakes and Discord answers
 * 404 either way — so `init` checks for it explicitly and offers the real
 * channels instead.
 */
export async function probeGuildTextChannels(
  rest: REST,
  guildId: string,
): Promise<{ isGuild: boolean; name?: string; channels: { id: string; name: string }[] }> {
  try {
    const guild = (await rest.get(Routes.guild(guildId))) as { name?: string };
    let channels: { id: string; name: string }[] = [];
    try {
      const all = (await rest.get(Routes.guildChannels(guildId))) as {
        id: string;
        type: number;
        name?: string;
      }[];
      channels = all
        .filter((c) => c.type === ChannelType.GuildText)
        .map((c) => ({ id: c.id, name: c.name ?? c.id }));
    } catch {
      // Listing channels needs View Channel; the guild hit alone is enough to explain the mistake.
    }
    return { isGuild: true, name: guild.name, channels };
  } catch {
    return { isGuild: false, channels: [] };
  }
}

function message(err: unknown): string {
  const e = err as { status?: number; code?: number | string; message?: string };
  if (e?.status) return `HTTP ${e.status}${e.message ? `: ${e.message}` : ""}`;
  return err instanceof Error ? err.message : String(err);
}
