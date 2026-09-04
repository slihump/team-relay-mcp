import type { LocalState, StoredConversation } from "../state/store.js";
import type { RawMessage } from "../transport/transport.js";
import { log } from "../logger.js";
import type { Payload } from "./types.js";

/**
 * Fold one verified payload into the conversation map. `raw` is the transport
 * message it came from (used for timestamps and dedup).
 *
 * Idempotent: replaying the same message is a no-op, so a crash between "posted
 * to channel" and "saved state" is self-healing on the next sync.
 */
export function applyPayload(state: LocalState, payload: Payload, raw: RawMessage): void {
  switch (payload.t) {
    case "question": {
      const existing = state.conversations[payload.cid];
      if (existing) {
        existing.question = payload;
        touch(existing, raw.createdAt);
      } else {
        state.conversations[payload.cid] = {
          cid: payload.cid,
          question: payload,
          answers: [],
          acks: [],
          firstSeenAt: raw.createdAt,
          lastActivityAt: raw.createdAt,
        };
      }
      return;
    }
    case "answer": {
      const conv = state.conversations[payload.cid];
      if (!conv) {
        log.debug(
          `answer for unknown conversation ${payload.cid}; ignoring until its question arrives`,
        );
        return;
      }
      if (!conv.answers.some((a) => sameEvent(a, payload, raw))) {
        conv.answers.push(payload);
        touch(conv, raw.createdAt);
      }
      return;
    }
    case "ack": {
      const conv = state.conversations[payload.cid];
      if (!conv) return;
      if (!conv.acks.some((a) => sameEvent(a, payload, raw))) {
        conv.acks.push(payload);
        touch(conv, raw.createdAt);
      }
      return;
    }
    case "decision":
      // Kept in state so the decisions-file write can be retried each sync
      // until it succeeds, even if the cursor has moved past this message.
      state.decisions[payload.did] = payload;
      return;
    case "note":
      // Ephemeral FYI — surfaced once by the digest, not part of stored state.
      return;
  }
}

function touch(conv: StoredConversation, at: string): void {
  if (at > conv.lastActivityAt) conv.lastActivityAt = at;
}

function sameEvent(
  a: { from: string; ts: string; text?: string; note?: string },
  b: { from: string; ts: string; text?: string; note?: string },
  _raw: RawMessage,
): boolean {
  return a.from === b.from && a.ts === b.ts && (a.text ?? a.note) === (b.text ?? b.note);
}
