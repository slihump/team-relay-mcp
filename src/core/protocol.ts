import { type Payload, PayloadSchema } from "./types.js";

/**
 * Messages on the wire look like:
 *
 *   🙋 alice → bob · k7m2p9qd
 *   Did the getUser signature change?
 *
 *   ⟪team-relay⟫ {"v":1,"t":"question",...}
 *
 * The human part is for people reading the channel. The `⟪team-relay⟫` line is
 * the machine-readable payload — that is what the server parses back out.
 * Routing never depends on the human text.
 */

export const SENTINEL = "⟪team-relay⟫";

export function encode(payload: Payload): string {
  return `${renderHuman(payload)}\n\n${SENTINEL} ${JSON.stringify(payload)}`;
}

/**
 * Returns the payload if the text carries a valid one, otherwise null.
 * Plain human chatter in the channel decodes to null and is ignored.
 */
export function decode(text: string): Payload | null {
  const at = text.indexOf(SENTINEL);
  if (at === -1) return null;
  const jsonStart = at + SENTINEL.length;
  const raw = text.slice(jsonStart).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractLeadingJson(raw));
  } catch {
    return null;
  }
  const result = PayloadSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * The payload is a single JSON object. If a transport appended anything after
 * it (quote markers, signatures), keep only the balanced leading object.
 */
function extractLeadingJson(s: string): string {
  if (!s.startsWith("{")) return s;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  return s;
}

export function renderHuman(payload: Payload): string {
  switch (payload.t) {
    case "question": {
      const arrow = payload.broadcast
        ? `${payload.from} → team`
        : `${payload.from} → ${payload.to.join(", ")}`;
      const lines = [`🙋 ${arrow} · ${payload.cid}`, payload.text];
      if (payload.context) lines.push("", `context: ${payload.context}`);
      return lines.join("\n");
    }
    case "answer":
      return [`💬 ${payload.from} · re ${payload.cid}`, payload.text].join("\n");
    case "ack":
      return `✅ ${payload.from} · ack ${payload.cid}${payload.note ? ` — ${payload.note}` : ""}`;
    case "decision": {
      const lines = [`📌 decision · ${payload.topic} (by ${payload.from})`, payload.decision];
      if (payload.rationale) lines.push("", `why: ${payload.rationale}`);
      return lines.join("\n");
    }
    case "note": {
      const target = payload.to && payload.to.length > 0 ? payload.to.join(", ") : "team";
      return [`📣 ${payload.from} → ${target}`, payload.text].join("\n");
    }
  }
}
