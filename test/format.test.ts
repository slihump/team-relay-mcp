import { describe, expect, it } from "vitest";
import { formatSync } from "../src/format.js";
import type { SyncResult } from "../src/relay.js";

const empty: SyncResult = {
  questionsForMe: [],
  answersForMe: [],
  awaitingReplies: [],
  newDecisions: [],
  notes: [],
  empty: true,
  scannedMessages: 3,
  droppedUnknownSender: 0,
  droppedSenderMismatch: 0,
};

describe("formatSync", () => {
  it("renders the empty case", () => {
    expect(formatSync(empty)).toBe(
      "team_sync - nothing needs your attention right now.\n\nscanned 3 new message(s)",
    );
  });

  it("still shows 'still waiting on' when otherwise empty", () => {
    const out = formatSync({
      ...empty,
      awaitingReplies: [{ cid: "ab12cd34", question: "ping?", to: ["bob"], waitingHours: 6 }],
    });
    expect(out).toContain("nothing needs your attention");
    expect(out).toContain("STILL WAITING ON:");
    expect(out).toContain("[ab12cd34] you asked bob (6h ago): ping?");
  });

  it("renders a full digest with actionable hints and a drop count", () => {
    const out = formatSync({
      ...empty,
      empty: false,
      scannedMessages: 14,
      droppedSenderMismatch: 1,
      questionsForMe: [
        {
          cid: "k7m2p9qd",
          from: "bob",
          broadcast: false,
          text: "Did the getUser signature change?",
          context: "callers in src/api",
          askedAt: "2026-09-04T09:00:00.000Z",
          waitingHours: 3.2,
        },
      ],
      answersForMe: [
        {
          cid: "x9k2m4p1",
          question: "Refresh tokens client-side?",
          context: undefined,
          answers: [
            { from: "alice", text: "No, the gateway handles it.", at: "2026-09-04T10:00:00.000Z" },
          ],
        },
      ],
      newDecisions: [
        {
          v: 1,
          t: "decision",
          did: "d4h9x2r",
          from: "alice",
          topic: "zod version",
          decision: "pin to v3",
          rationale: "SDK peer range",
          ts: "2026-09-04T10:07:00.000Z",
        },
      ],
    });

    expect(out).toContain("QUESTIONS TO ANSWER (1)");
    expect(out).toContain('reply(conversation_id="k7m2p9qd"');
    expect(out).toContain("ANSWERS TO YOUR QUESTIONS (1)");
    expect(out).toContain('ack(conversation_id="x9k2m4p1")');
    expect(out).toContain("NEW TEAM DECISIONS (1)");
    expect(out).toContain("dropped 1 (0 unknown sender, 1 name mismatch)");
    // ASCII only — safe for any terminal
    expect(/[^\x00-\x7F]/.test(out)).toBe(false);
  });
});
