import type { REST } from "@discordjs/rest";
import { describe, expect, it } from "vitest";
import { probeGuilds, probeGuildTextChannels } from "../src/cli/discord-probe.js";

/** Minimal REST stub: maps a route substring to a response or an error to throw. */
function stub(handler: (route: string) => unknown): REST {
  return {
    get: async (route: string) => {
      const out = handler(route);
      if (out instanceof Error) throw out;
      return out;
    },
  } as unknown as REST;
}

describe("probeGuilds", () => {
  it("returns the guilds the bot is in", async () => {
    const rest = stub(() => [
      { id: "1", name: "team" },
      { id: "2", name: "other" },
    ]);
    const res = await probeGuilds(rest);
    expect(res.ok).toBe(true);
    expect(res.guilds).toEqual([
      { id: "1", name: "team" },
      { id: "2", name: "other" },
    ]);
  });

  it("reports an empty roster as not-ok so the caller can prompt for an invite", async () => {
    const res = await probeGuilds(stub(() => []));
    expect(res.ok).toBe(false);
    expect(res.guilds).toEqual([]);
  });

  it("survives an API failure", async () => {
    const res = await probeGuilds(stub(() => Object.assign(new Error("nope"), { status: 401 })));
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("401");
  });
});

describe("probeGuildTextChannels", () => {
  it("keeps only text channels", async () => {
    const rest = stub((route) =>
      route.includes("/channels")
        ? [
            { id: "10", type: 0, name: "general" },
            { id: "11", type: 2, name: "voice" },
            { id: "12", type: 4, name: "category" },
          ]
        : { name: "team" },
    );
    const res = await probeGuildTextChannels(rest, "1");
    expect(res.isGuild).toBe(true);
    expect(res.name).toBe("team");
    expect(res.channels).toEqual([{ id: "10", name: "general" }]);
  });

  it("reports a non-guild id", async () => {
    const res = await probeGuildTextChannels(
      stub(() => Object.assign(new Error("Unknown Guild"), { status: 404 })),
      "999",
    );
    expect(res.isGuild).toBe(false);
    expect(res.channels).toEqual([]);
  });
});
