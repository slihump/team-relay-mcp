import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/config.js";
import { Relay } from "../src/relay.js";
import { Store } from "../src/state/store.js";
import { InMemoryChannel, InMemoryTransport } from "../src/transport/memory.js";

export const ROSTER = [
  { name: "alice", id: "alice-id" },
  { name: "bob", id: "bob-id" },
  { name: "carol", id: "carol-id" },
];

export function makeConfig(me: string, decisionsFile: string): Config {
  return {
    me,
    channelId: "test-channel",
    teammates: ROSTER,
    rosterById: new Map(ROSTER.map((t) => [t.id, t.name])),
    transport: "memory",
    decisionsFile,
    configDir: "",
    discordToken: undefined,
  };
}

export interface Harness {
  channel: InMemoryChannel;
  /** Cached relay for a teammate — the same instance across calls. */
  relayFor: (me: string) => Relay;
  /** A new relay instance for a teammate with an empty local store (simulates a restart). */
  freshRelayFor: (me: string) => Relay;
  /** A transport whose author id is not in the roster. */
  strangerTransport: (id: string, name?: string) => InMemoryTransport;
  decisionsFile: (name: string) => string;
  cleanup: () => void;
}

export function makeHarness(): Harness {
  const channel = new InMemoryChannel();
  const dir = mkdtempSync(join(tmpdir(), "team-relay-test-"));
  const relays = new Map<string, Relay>();

  const build = (me: string): Relay => {
    const cfg = makeConfig(me, join(dir, `${me}-decisions.md`));
    const transport = new InMemoryTransport(channel, { id: `${me}-id`, name: me });
    return new Relay(cfg, transport, Store.ephemeral());
  };

  return {
    channel,
    relayFor(me: string) {
      let r = relays.get(me);
      if (!r) {
        r = build(me);
        relays.set(me, r);
      }
      return r;
    },
    freshRelayFor: build,
    strangerTransport(id: string, name?: string) {
      return new InMemoryTransport(channel, { id, name: name ?? id });
    },
    decisionsFile(name: string) {
      return join(dir, name);
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
