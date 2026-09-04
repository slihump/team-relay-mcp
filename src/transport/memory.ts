import { randomUUID } from "node:crypto";
import type { FetchOptions, RawMessage, TeamTransport } from "./transport.js";

/**
 * A shared in-process channel. Create one, then attach a transport per
 * participant. Used by the test suite and by `--transport memory` for trying
 * the tools without a Discord bot.
 */
export class InMemoryChannel {
  private readonly messages: RawMessage[] = [];
  private seq = 0;

  append(author: { id: string; name?: string }, text: string): RawMessage {
    // Zero-padded so lexical order == chronological order.
    const id = String(++this.seq).padStart(12, "0");
    const msg: RawMessage = {
      id,
      author,
      text,
      createdAt: new Date().toISOString(),
    };
    this.messages.push(msg);
    return { ...msg };
  }

  since(cursor: string | null, limit = 100): RawMessage[] {
    const all =
      cursor === null ? this.messages.slice(-20) : this.messages.filter((m) => m.id > cursor);
    return all.slice(0, limit).map((m) => ({ ...m }));
  }

  get all(): readonly RawMessage[] {
    return this.messages.map((m) => ({ ...m }));
  }
}

export class InMemoryTransport implements TeamTransport {
  readonly selfId: string;
  private readonly channel: InMemoryChannel;
  private readonly name: string | undefined;

  constructor(channel: InMemoryChannel, identity: { id?: string; name?: string } = {}) {
    this.channel = channel;
    this.selfId = identity.id ?? randomUUID();
    this.name = identity.name;
  }

  async connect(): Promise<void> {}

  async send(text: string): Promise<RawMessage> {
    return this.channel.append({ id: this.selfId, name: this.name }, text);
  }

  async fetchSince(cursor: string | null, opts?: FetchOptions): Promise<RawMessage[]> {
    return this.channel.since(cursor, opts?.limit ?? 100);
  }

  async close(): Promise<void> {}
}
