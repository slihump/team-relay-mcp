import { REST } from "@discordjs/rest";
import { type APIMessage, type APIUser, type RESTError, Routes } from "discord-api-types/v10";
import { log } from "../logger.js";
import type { FetchOptions, RawMessage, TeamTransport } from "./transport.js";

/**
 * Discord transport, REST only — no gateway, no websocket, no persistent
 * connection. Real-time delivery is out of scope for v1 (see ROADMAP);
 * `team_sync` polls history instead.
 *
 * Requires the bot's "Message Content" intent to be enabled in the Developer
 * Portal, otherwise `content` comes back empty for other bots' messages.
 */
export class DiscordTransport implements TeamTransport {
  private readonly rest: REST;
  private readonly channelId: string;
  private _selfId = "";
  private connected = false;

  constructor(opts: { token: string; channelId: string }) {
    if (!opts.token) throw new Error("DISCORD_BOT_TOKEN is not set.");
    if (!opts.channelId) throw new Error("channelId is not set.");
    this.channelId = opts.channelId;
    this.rest = new REST({ version: "10" }).setToken(opts.token);
  }

  get selfId(): string {
    return this._selfId;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    try {
      const me = (await this.rest.get(Routes.user("@me"))) as APIUser;
      this._selfId = me.id;
    } catch (err) {
      throw new Error(`Discord auth failed. Check DISCORD_BOT_TOKEN. (${describe(err)})`);
    }
    try {
      await this.rest.get(Routes.channel(this.channelId));
    } catch (err) {
      throw new Error(
        `Cannot access channel ${this.channelId}. Check the id and that the bot was invited ` +
          `with View Channel + Read Message History + Send Messages. (${describe(err)})`,
      );
    }
    this.connected = true;
    log.info(`Discord ready as bot ${this._selfId}, channel ${this.channelId}`);
  }

  async send(text: string): Promise<RawMessage> {
    const msg = (await this.rest.post(Routes.channelMessages(this.channelId), {
      body: { content: text },
    })) as APIMessage;
    return toRaw(msg);
  }

  async fetchSince(cursor: string | null, opts?: FetchOptions): Promise<RawMessage[]> {
    const hardCap = opts?.limit ?? 200;

    if (cursor === null) {
      const page = await this.page({ limit: 20 });
      return page.map(toRaw).reverse().slice(-hardCap);
    }

    // Page forward from the cursor. Discord's `after` returns the batch of
    // messages immediately after the given id (oldest-first-after-cursor),
    // newest-first within the response; we reverse and advance by the newest id.
    const out: RawMessage[] = [];
    let after = cursor;
    while (out.length < hardCap) {
      const page = await this.page({ after, limit: 100 });
      if (page.length === 0) break;
      const oldestFirst = [...page].reverse();
      for (const m of oldestFirst) out.push(toRaw(m));
      after = oldestFirst[oldestFirst.length - 1]!.id;
      if (page.length < 100) break;
    }
    return out.slice(0, hardCap);
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  private async page(params: { after?: string; limit: number }): Promise<APIMessage[]> {
    const query = new URLSearchParams({ limit: String(params.limit) });
    if (params.after) query.set("after", params.after);
    return (await this.rest.get(Routes.channelMessages(this.channelId), { query })) as APIMessage[];
  }
}

function toRaw(m: APIMessage): RawMessage {
  return {
    id: m.id,
    author: { id: m.author.id, name: m.author.username },
    text: m.content ?? "",
    createdAt: m.timestamp,
  };
}

function describe(err: unknown): string {
  const e = err as Partial<RESTError> & { status?: number; message?: string };
  if (e?.status && e?.message) return `HTTP ${e.status}: ${e.message}`;
  if (e?.code && e?.message) return `${e.code}: ${e.message}`;
  return err instanceof Error ? err.message : String(err);
}
