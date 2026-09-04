import { describe, expect, it } from "vitest";
import { InMemoryChannel, InMemoryTransport } from "../src/transport/memory.js";

describe("InMemoryTransport (transport contract)", () => {
  it("returns only messages strictly after the cursor, oldest first", async () => {
    const channel = new InMemoryChannel();
    const a = new InMemoryTransport(channel, { id: "a" });
    const b = new InMemoryTransport(channel, { id: "b" });

    const m1 = await a.send("one");
    const m2 = await b.send("two");
    const m3 = await a.send("three");

    const all = await b.fetchSince(null);
    expect(all.map((m) => m.text)).toEqual(["one", "two", "three"]);

    const afterFirst = await b.fetchSince(m1.id);
    expect(afterFirst.map((m) => m.text)).toEqual(["two", "three"]);
    expect(afterFirst[0]!.id).toBe(m2.id);

    const afterLast = await b.fetchSince(m3.id);
    expect(afterLast).toEqual([]);
  });

  it("reports the author id used for verification", async () => {
    const channel = new InMemoryChannel();
    const a = new InMemoryTransport(channel, { id: "alice-id", name: "alice" });
    const sent = await a.send("hi");
    expect(sent.author.id).toBe("alice-id");
    expect(a.selfId).toBe("alice-id");
  });

  it("honours the limit", async () => {
    const channel = new InMemoryChannel();
    const a = new InMemoryTransport(channel, { id: "a" });
    for (let i = 0; i < 10; i++) await a.send(`m${i}`);
    const limited = await a.fetchSince("000000000000", { limit: 3 });
    expect(limited).toHaveLength(3);
    expect(limited.map((m) => m.text)).toEqual(["m0", "m1", "m2"]);
  });
});
