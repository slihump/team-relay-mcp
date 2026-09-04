import type { LocalState, StoredConversation } from "../state/store.js";
import {
  type DecisionPayload,
  nameInList,
  nameKey,
  namesEqual,
  type NotePayload,
} from "./types.js";

export interface OpenQuestion {
  cid: string;
  from: string;
  broadcast: boolean;
  text: string;
  context: string | undefined;
  askedAt: string;
  waitingHours: number;
}

export interface AnsweredThread {
  cid: string;
  question: string;
  context: string | undefined;
  answers: { from: string; text: string; at: string }[];
}

export interface DeliveredNote {
  id: string;
  from: string;
  text: string;
  at: string;
}

export interface Digest {
  /** Questions addressed to me that I have not answered yet. Re-surfaces every sync until I reply. */
  questionsForMe: OpenQuestion[];
  /** My own questions that have replies I have not acknowledged. Re-surfaces until I ack. */
  answersForMe: AnsweredThread[];
  /** Decisions recorded by teammates that are new since the last sync. */
  newDecisions: DecisionPayload[];
  /** Broadcast notes to me / the team that have not been shown before. */
  notes: DeliveredNote[];
  /** True when nothing above needs my attention. */
  empty: boolean;
}

export interface DigestInputs {
  state: LocalState;
  me: string;
  now?: Date;
  /** Decisions collected during this sync, with the raw message id that carried them. */
  incomingDecisions: { id: string; decision: DecisionPayload }[];
  /** Notes collected during this sync, with the raw message id that carried them. */
  incomingNotes: { id: string; note: NotePayload }[];
}

export function computeDigest(input: DigestInputs): Digest {
  const { state, me } = input;
  const now = input.now ?? new Date();

  const questionsForMe: OpenQuestion[] = [];
  const answersForMe: AnsweredThread[] = [];

  for (const conv of Object.values(state.conversations)) {
    const q = conv.question;

    if (nameInList(me, q.to) && !namesEqual(q.from, me) && !iHaveAnswered(conv, me)) {
      questionsForMe.push({
        cid: q.cid,
        from: q.from,
        broadcast: q.broadcast,
        text: q.text,
        context: q.context,
        askedAt: conv.firstSeenAt,
        waitingHours: hoursBetween(conv.firstSeenAt, now),
      });
    }

    if (namesEqual(q.from, me) && conv.answers.length > 0 && !iHaveAckedLatest(conv, me)) {
      answersForMe.push({
        cid: q.cid,
        question: q.text,
        context: q.context,
        answers: conv.answers.map((a) => ({ from: a.from, text: a.text, at: a.ts })),
      });
    }
  }

  questionsForMe.sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  answersForMe.sort((a, b) => a.cid.localeCompare(b.cid));

  const newDecisions = input.incomingDecisions
    .filter((d) => !state.recordedDecisionIds.includes(d.decision.did))
    .map((d) => d.decision);

  const notes: DeliveredNote[] = input.incomingNotes
    .filter(({ id, note }) => {
      if (state.shownNoteIds.includes(id)) return false;
      if (namesEqual(note.from, me)) return false;
      if (note.to && note.to.length > 0) return nameInList(me, note.to);
      return true;
    })
    .map(({ id, note }) => ({ id, from: note.from, text: note.text, at: note.ts }));

  return {
    questionsForMe,
    answersForMe,
    newDecisions,
    notes,
    empty:
      questionsForMe.length === 0 &&
      answersForMe.length === 0 &&
      newDecisions.length === 0 &&
      notes.length === 0,
  };
}

function iHaveAnswered(conv: StoredConversation, me: string): boolean {
  return conv.answers.some((a) => namesEqual(a.from, me));
}

function iHaveAckedLatest(conv: StoredConversation, me: string): boolean {
  const myAcks = conv.acks.filter((a) => namesEqual(a.from, me));
  if (myAcks.length === 0) return false;
  const latestAck = myAcks.reduce((max, a) => (a.ts > max ? a.ts : max), myAcks[0]!.ts);
  const latestAnswer = conv.answers.reduce((max, a) => (a.ts > max ? a.ts : max), "");
  return latestAck >= latestAnswer;
}

function hoursBetween(iso: string, now: Date): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.round(((now.getTime() - then) / 3_600_000) * 10) / 10);
}

export { nameKey };
