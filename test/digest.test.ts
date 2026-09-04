import { describe, expect, it } from "vitest";
import { computeDigest } from "../src/core/digest.js";
import type { LocalState } from "../src/state/store.js";
import type { AnswerPayload, QuestionPayload } from "../src/core/types.js";

function baseState(): LocalState {
  return {
    version: 1,
    cursor: null,
    conversations: {},
    recordedDecisionIds: [],
    shownNoteIds: [],
  };
}

function q(over: Partial<QuestionPayload> = {}): QuestionPayload {
  return {
    v: 1,
    t: "question",
    cid: "c1",
    from: "bob",
    to: ["alice"],
    broadcast: false,
    text: "why does auth retry twice?",
    ts: "2026-09-04T09:00:00.000Z",
    ...over,
  };
}

function ans(over: Partial<AnswerPayload> = {}): AnswerPayload {
  return {
    v: 1,
    t: "answer",
    cid: "c1",
    from: "alice",
    text: "clock skew",
    ts: "2026-09-04T09:30:00.000Z",
    ...over,
  };
}

describe("computeDigest", () => {
  it("surfaces a question addressed to me that I have not answered", () => {
    const state = baseState();
    state.conversations.c1 = {
      cid: "c1",
      question: q(),
      answers: [],
      acks: [],
      firstSeenAt: "2026-09-04T09:00:00.000Z",
      lastActivityAt: "2026-09-04T09:00:00.000Z",
    };
    const d = computeDigest({
      state,
      me: "alice",
      now: new Date("2026-09-04T12:00:00.000Z"),
      incomingDecisions: [],
      incomingNotes: [],
    });
    expect(d.questionsForMe.map((x) => x.cid)).toEqual(["c1"]);
    expect(d.questionsForMe[0]!.waitingHours).toBe(3);
    expect(d.empty).toBe(false);
  });

  it("stops surfacing a question once I have answered it", () => {
    const state = baseState();
    state.conversations.c1 = {
      cid: "c1",
      question: q(),
      answers: [ans()],
      acks: [],
      firstSeenAt: "x",
      lastActivityAt: "x",
    };
    const d = computeDigest({ state, me: "alice", incomingDecisions: [], incomingNotes: [] });
    expect(d.questionsForMe).toHaveLength(0);
  });

  it("shows answers to my question until I ack the latest one", () => {
    const state = baseState();
    state.conversations.c1 = {
      cid: "c1",
      question: q({ from: "alice", to: ["bob"] }),
      answers: [ans({ from: "bob" })],
      acks: [],
      firstSeenAt: "x",
      lastActivityAt: "x",
    };
    let d = computeDigest({ state, me: "alice", incomingDecisions: [], incomingNotes: [] });
    expect(d.answersForMe.map((x) => x.cid)).toEqual(["c1"]);

    state.conversations.c1!.acks.push({
      v: 1,
      t: "ack",
      cid: "c1",
      from: "alice",
      ts: "2026-09-04T10:00:00.000Z",
    });
    d = computeDigest({ state, me: "alice", incomingDecisions: [], incomingNotes: [] });
    expect(d.answersForMe).toHaveLength(0);

    // a newer answer re-opens it
    state.conversations.c1!.answers.push(
      ans({ from: "bob", text: "actually, also DNS", ts: "2026-09-04T11:00:00.000Z" }),
    );
    d = computeDigest({ state, me: "alice", incomingDecisions: [], incomingNotes: [] });
    expect(d.answersForMe).toHaveLength(1);
  });

  it("dedupes decisions already recorded and filters notes for me", () => {
    const state = baseState();
    state.recordedDecisionIds.push("d-old");
    const d = computeDigest({
      state,
      me: "alice",
      incomingDecisions: [
        {
          id: "m1",
          decision: {
            v: 1,
            t: "decision",
            did: "d-old",
            from: "bob",
            topic: "t",
            decision: "x",
            ts: "2026-09-04T09:00:00.000Z",
          },
        },
        {
          id: "m2",
          decision: {
            v: 1,
            t: "decision",
            did: "d-new",
            from: "bob",
            topic: "t2",
            decision: "y",
            ts: "2026-09-04T09:00:00.000Z",
          },
        },
      ],
      incomingNotes: [
        {
          id: "n1",
          note: {
            v: 1,
            t: "note",
            from: "bob",
            text: "for alice",
            to: ["alice"],
            ts: "2026-09-04T09:00:00.000Z",
          },
        },
        {
          id: "n2",
          note: {
            v: 1,
            t: "note",
            from: "bob",
            text: "for carol only",
            to: ["carol"],
            ts: "2026-09-04T09:00:00.000Z",
          },
        },
        {
          id: "n3",
          note: {
            v: 1,
            t: "note",
            from: "alice",
            text: "my own note",
            ts: "2026-09-04T09:00:00.000Z",
          },
        },
      ],
    });
    expect(d.newDecisions.map((x) => x.did)).toEqual(["d-new"]);
    expect(d.notes.map((x) => x.id)).toEqual(["n1"]);
  });
});
