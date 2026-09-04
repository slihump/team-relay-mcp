import type { Config } from "./config.js";
import { applyPayload } from "./core/conversations.js";
import { syncDecisionsFile } from "./core/decisions.js";
import { computeDigest, type Digest } from "./core/digest.js";
import { conversationId, decisionId } from "./core/ids.js";
import { decode, encode } from "./core/protocol.js";
import {
  type DecisionPayload,
  nameInList,
  nameKey,
  namesEqual,
  type NotePayload,
  type Payload,
} from "./core/types.js";
import { log } from "./logger.js";
import type { Store } from "./state/store.js";
import type { RawMessage, TeamTransport } from "./transport/transport.js";

export class RelayError extends Error {}

export interface AskInput {
  to?: string;
  question: string;
  context?: string;
  broadcast?: boolean;
}

export interface SyncResult extends Digest {
  scannedMessages: number;
  droppedUnknownSender: number;
  droppedSenderMismatch: number;
}

/**
 * The relay owns the flow: pull from the channel, verify authorship, fold
 * messages into local state, and expose the six actions the MCP tools map to.
 */
export class Relay {
  constructor(
    private readonly cfg: Config,
    private readonly transport: TeamTransport,
    private readonly store: Store,
  ) {}

  private get teammateNames(): string[] {
    return this.cfg.teammates.map((t) => t.name);
  }

  private otherTeammates(): string[] {
    return this.teammateNames.filter((n) => !namesEqual(n, this.cfg.me));
  }

  async connect(): Promise<void> {
    await this.transport.connect();
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  /** Catch up on the channel and report what needs my attention. */
  async sync(now = new Date()): Promise<SyncResult> {
    const raw = await this.transport.fetchSince(this.store.data.cursor, { limit: 200 });

    let droppedUnknownSender = 0;
    let droppedSenderMismatch = 0;
    const incomingDecisions: { id: string; decision: DecisionPayload }[] = [];
    const incomingNotes: { id: string; note: NotePayload }[] = [];

    this.store.mutate((state) => {
      for (const msg of raw) {
        const verified = this.verify(msg);
        if (verified === "unknown") {
          droppedUnknownSender++;
          continue;
        }
        if (verified === "mismatch") {
          droppedSenderMismatch++;
          continue;
        }
        if (verified === null) continue; // human chatter

        if (verified.t === "decision") {
          incomingDecisions.push({ id: msg.id, decision: verified });
        } else if (verified.t === "note") {
          incomingNotes.push({ id: msg.id, note: verified });
        } else {
          applyPayload(state, verified, msg);
        }
      }
      if (raw.length > 0) {
        state.cursor = raw[raw.length - 1]!.id;
      }
    });

    const digest = computeDigest({
      state: this.store.data,
      me: this.cfg.me,
      now,
      incomingDecisions,
      incomingNotes,
    });

    if (digest.newDecisions.length > 0) {
      const written = syncDecisionsFile(this.cfg.decisionsFile, digest.newDecisions);
      if (written.length > 0) {
        this.store.mutate((s) => {
          s.recordedDecisionIds.push(...written);
        });
      }
    }
    if (digest.notes.length > 0) {
      this.store.mutate((s) => {
        s.shownNoteIds.push(...digest.notes.map((n) => n.id));
      });
    }

    return {
      ...digest,
      scannedMessages: raw.length,
      droppedUnknownSender,
      droppedSenderMismatch,
    };
  }

  async ask(input: AskInput): Promise<{ cid: string; recipients: string[] }> {
    const broadcast = input.broadcast ?? !input.to;
    let recipients: string[];

    if (broadcast) {
      recipients = this.otherTeammates();
      if (recipients.length === 0) throw new RelayError("No other teammates in the roster.");
    } else {
      const match = this.teammateNames.find((n) => namesEqual(n, input.to!));
      if (!match) {
        throw new RelayError(
          `Unknown teammate "${input.to}". Known: ${this.otherTeammates().join(", ") || "(none)"}.`,
        );
      }
      if (namesEqual(match, this.cfg.me))
        throw new RelayError("You cannot send a question to yourself.");
      recipients = [match];
    }

    const payload: Payload = {
      v: 1,
      t: "question",
      cid: conversationId(),
      from: this.cfg.me,
      to: recipients,
      broadcast,
      text: input.question.trim(),
      ...(input.context?.trim() ? { context: input.context.trim() } : {}),
      ts: new Date().toISOString(),
    };

    await this.post(payload);
    return { cid: payload.cid, recipients };
  }

  async reply(input: { cid: string; answer: string }): Promise<{ to: string }> {
    const conv = this.store.data.conversations[input.cid];
    if (!conv) {
      throw new RelayError(
        `No conversation ${input.cid} in local state. Run team_sync first, or check the id.`,
      );
    }
    if (
      !nameInList(this.cfg.me, conv.question.to) &&
      !namesEqual(conv.question.from, this.cfg.me)
    ) {
      throw new RelayError(`Conversation ${input.cid} was not addressed to you.`);
    }
    const payload: Payload = {
      v: 1,
      t: "answer",
      cid: input.cid,
      from: this.cfg.me,
      text: input.answer.trim(),
      ts: new Date().toISOString(),
    };
    await this.post(payload);
    return { to: conv.question.from };
  }

  async ack(input: { cid: string; note?: string }): Promise<void> {
    const conv = this.store.data.conversations[input.cid];
    if (!conv) throw new RelayError(`No conversation ${input.cid} in local state.`);
    if (!namesEqual(conv.question.from, this.cfg.me)) {
      throw new RelayError(
        `Only ${conv.question.from} (who asked ${input.cid}) can acknowledge it.`,
      );
    }
    const payload: Payload = {
      v: 1,
      t: "ack",
      cid: input.cid,
      from: this.cfg.me,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      ts: new Date().toISOString(),
    };
    await this.post(payload);
  }

  async recordDecision(input: {
    topic: string;
    decision: string;
    rationale?: string;
  }): Promise<{ did: string }> {
    const payload: Payload = {
      v: 1,
      t: "decision",
      did: decisionId(),
      from: this.cfg.me,
      topic: input.topic.trim(),
      decision: input.decision.trim(),
      ...(input.rationale?.trim() ? { rationale: input.rationale.trim() } : {}),
      ts: new Date().toISOString(),
    };
    await this.post(payload);
    // Reflect it into our own file immediately; other teammates get it on their next sync.
    const written = syncDecisionsFile(this.cfg.decisionsFile, [payload]);
    if (written.length > 0) {
      this.store.mutate((s) => s.recordedDecisionIds.push(...written));
    }
    return { did: payload.did };
  }

  async note(input: { text: string; to?: string[] }): Promise<void> {
    const payload: Payload = {
      v: 1,
      t: "note",
      from: this.cfg.me,
      ...(input.to && input.to.length > 0 ? { to: input.to } : {}),
      text: input.text.trim(),
      ts: new Date().toISOString(),
    };
    await this.post(payload);
  }

  private async post(payload: Payload): Promise<void> {
    const text = encode(payload);
    if (text.length > 1900) {
      throw new RelayError(
        `Message is too long for the channel (${text.length} chars). Trim the question/answer/context and try again.`,
      );
    }
    const sent = await this.transport.send(text);
    // Fold our own message in right away so local state matches the channel
    // without waiting for the next sync.
    if (payload.t === "question" || payload.t === "answer" || payload.t === "ack") {
      this.store.mutate((s) => applyPayload(s, payload, sent));
    }
  }

  /**
   * "unknown" = author is not in the roster (dropped).
   * "mismatch" = payload.from does not match the roster name for this author (spoof; dropped).
   * null = no valid payload (human chatter; ignored).
   */
  private verify(msg: RawMessage): Payload | "unknown" | "mismatch" | null {
    const payload = decode(msg.text);
    if (!payload) return null;

    const expectedName = this.cfg.rosterById.get(msg.author.id);
    if (!expectedName) {
      log.warn(`dropping relay message from unknown sender id=${msg.author.id}`);
      return "unknown";
    }
    if (nameKey(expectedName) !== nameKey(payload.from)) {
      log.warn(
        `dropping relay message: sender id=${msg.author.id} is "${expectedName}" but payload claims from="${payload.from}"`,
      );
      return "mismatch";
    }
    return payload;
  }
}
