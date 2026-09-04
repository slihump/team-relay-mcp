import { describe, expect, it } from "vitest";
import { applyPayload } from "../src/core/conversations.js";
import type { AnswerPayload, QuestionPayload } from "../src/core/types.js";
import type { LocalState } from "../src/state/store.js";
import type { RawMessage } from "../src/transport/transport.js";

function state(): LocalState {
  return { version: 1, cursor: null, conversations: {}, recordedDecisionIds: [], shownNoteIds: [] };
}
function raw(id: string, at = "2026-09-04T09:00:00.000Z"): RawMessage {
  return { id, author: { id: "x" }, text: "", createdAt: at };
}

const q: QuestionPayload = {
  v: 1,
  t: "question",
  cid: "c1",
  from: "bob",
  to: ["alice"],
  broadcast: false,
  text: "q",
  ts: "2026-09-04T09:00:00.000Z",
};
const a: AnswerPayload = {
  v: 1,
  t: "answer",
  cid: "c1",
  from: "alice",
  text: "a",
  ts: "2026-09-04T09:30:00.000Z",
};

describe("applyPayload", () => {
  it("creates a conversation from a question and attaches answers", () => {
    const s = state();
    applyPayload(s, q, raw("1"));
    applyPayload(s, a, raw("2", "2026-09-04T09:30:00.000Z"));
    expect(s.conversations.c1!.answers).toHaveLength(1);
    expect(s.conversations.c1!.lastActivityAt).toBe("2026-09-04T09:30:00.000Z");
  });

  it("is idempotent when the same messages are replayed", () => {
    const s = state();
    for (let i = 0; i < 3; i++) {
      applyPayload(s, q, raw("1"));
      applyPayload(s, a, raw("2"));
    }
    expect(s.conversations.c1!.answers).toHaveLength(1);
  });

  it("holds an answer that arrives before its question is known", () => {
    const s = state();
    applyPayload(s, a, raw("2"));
    expect(s.conversations.c1).toBeUndefined();
    applyPayload(s, q, raw("1"));
    applyPayload(s, a, raw("2"));
    expect(s.conversations.c1!.answers).toHaveLength(1);
  });
});
