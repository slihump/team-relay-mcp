import { describe, expect, it } from "vitest";
import { decode, encode, renderHuman, SENTINEL } from "../src/core/protocol.js";
import type { Payload } from "../src/core/types.js";

const question: Payload = {
  v: 1,
  t: "question",
  cid: "k7m2p9qd",
  from: "alice",
  to: ["bob"],
  broadcast: false,
  text: "Did the getUser signature change?",
  context: "callers in src/api",
  ts: "2026-09-04T10:00:00.000Z",
};

describe("protocol", () => {
  it("round-trips every payload type", () => {
    const payloads: Payload[] = [
      question,
      {
        v: 1,
        t: "answer",
        cid: "k7m2p9qd",
        from: "bob",
        text: "yes, added opts",
        ts: "2026-09-04T10:05:00.000Z",
      },
      {
        v: 1,
        t: "ack",
        cid: "k7m2p9qd",
        from: "alice",
        note: "thanks",
        ts: "2026-09-04T10:06:00.000Z",
      },
      {
        v: 1,
        t: "decision",
        did: "d4h9x2r",
        from: "alice",
        topic: "zod version",
        decision: "use v3",
        rationale: "sdk peer range",
        ts: "2026-09-04T10:07:00.000Z",
      },
      { v: 1, t: "note", from: "bob", text: "refactoring auth", ts: "2026-09-04T10:08:00.000Z" },
    ];
    for (const p of payloads) {
      expect(decode(encode(p))).toEqual(p);
    }
  });

  it("puts a human-readable summary before the sentinel", () => {
    const text = encode(question);
    expect(text.indexOf("Did the getUser signature change?")).toBeLessThan(text.indexOf(SENTINEL));
    expect(text).toContain("alice → bob");
  });

  it("decodes plain human chatter as null", () => {
    expect(decode("hey has anyone seen the flaky test on main?")).toBeNull();
    expect(decode("")).toBeNull();
  });

  it("rejects a tampered / invalid payload", () => {
    expect(decode(`prefix ${SENTINEL} {"v":1,"t":"question"}`)).toBeNull(); // missing fields
    expect(decode(`${SENTINEL} not json`)).toBeNull();
    expect(decode(`${SENTINEL} {"v":2,"t":"question"}`)).toBeNull(); // wrong version
  });

  it("ignores junk appended after the JSON object", () => {
    const tampered = `${encode(question)}\n<!-- injected trailer -->`;
    expect(decode(tampered)).toEqual(question);
  });

  it("renders a broadcast question without a recipient list", () => {
    expect(renderHuman({ ...question, broadcast: true, to: ["bob", "carol"] })).toContain(
      "alice → team",
    );
  });
});
