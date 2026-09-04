import { z } from "zod";

/**
 * Wire payloads.
 *
 * Every relay message carries one of these as a JSON blob appended to the
 * human-readable text (see `core/protocol.ts`). The channel history is the
 * source of truth; these payloads are what we parse back out of it.
 *
 * `from` / `to` are teammate names. Names are compared case-insensitively
 * (see `nameKey`) but preserved as written for display.
 */

const isoDate = z.string().datetime({ offset: true });

const base = {
  v: z.literal(1),
  from: z.string().min(1).max(64),
  ts: isoDate,
};

export const QuestionPayloadSchema = z.object({
  ...base,
  t: z.literal("question"),
  cid: z.string().min(1).max(32),
  to: z.array(z.string().min(1).max(64)).min(1).max(32),
  broadcast: z.boolean(),
  text: z.string().min(1).max(6000),
  context: z.string().max(6000).optional(),
});

export const AnswerPayloadSchema = z.object({
  ...base,
  t: z.literal("answer"),
  cid: z.string().min(1).max(32),
  text: z.string().min(1).max(6000),
});

export const AckPayloadSchema = z.object({
  ...base,
  t: z.literal("ack"),
  cid: z.string().min(1).max(32),
  note: z.string().max(2000).optional(),
});

export const DecisionPayloadSchema = z.object({
  ...base,
  t: z.literal("decision"),
  did: z.string().min(1).max(32),
  topic: z.string().min(1).max(300),
  decision: z.string().min(1).max(4000),
  rationale: z.string().max(4000).optional(),
});

export const NotePayloadSchema = z.object({
  ...base,
  t: z.literal("note"),
  to: z.array(z.string().min(1).max(64)).max(32).optional(),
  text: z.string().min(1).max(6000),
});

export const PayloadSchema = z.discriminatedUnion("t", [
  QuestionPayloadSchema,
  AnswerPayloadSchema,
  AckPayloadSchema,
  DecisionPayloadSchema,
  NotePayloadSchema,
]);

export type QuestionPayload = z.infer<typeof QuestionPayloadSchema>;
export type AnswerPayload = z.infer<typeof AnswerPayloadSchema>;
export type AckPayload = z.infer<typeof AckPayloadSchema>;
export type DecisionPayload = z.infer<typeof DecisionPayloadSchema>;
export type NotePayload = z.infer<typeof NotePayloadSchema>;
export type Payload = z.infer<typeof PayloadSchema>;

/** Canonical key for case-insensitive name comparison. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function namesEqual(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b);
}

export function nameInList(name: string, list: readonly string[]): boolean {
  const key = nameKey(name);
  return list.some((n) => nameKey(n) === key);
}
