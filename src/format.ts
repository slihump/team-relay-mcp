import type { SyncResult } from "./relay.js";

/** Render a sync result as the text block the model reads in `team_sync`. */
export function formatSync(r: SyncResult): string {
  const sections: string[] = [];

  if (r.questionsForMe.length > 0) {
    const items = r.questionsForMe.map((q) => {
      const lines = [
        `  [${q.cid}] from ${q.from}${q.broadcast ? " (asked the whole team)" : ""} · waiting ${q.waitingHours}h`,
        indent(q.text, 4),
      ];
      if (q.context) lines.push(indent(`context: ${q.context}`, 4));
      lines.push(`    -> reply(conversation_id="${q.cid}", answer="...")`);
      return lines.join("\n");
    });
    sections.push(`QUESTIONS TO ANSWER (${r.questionsForMe.length})\n${items.join("\n\n")}`);
  }

  if (r.answersForMe.length > 0) {
    const items = r.answersForMe.map((t) => {
      const answerLines = t.answers.map((a) => indent(`${a.from}: ${a.text}`, 4));
      return [
        `  [${t.cid}] you asked: ${t.question}`,
        ...answerLines,
        `    -> ack(conversation_id="${t.cid}") if resolved, or reply(...) to follow up`,
      ].join("\n");
    });
    sections.push(`ANSWERS TO YOUR QUESTIONS (${r.answersForMe.length})\n${items.join("\n\n")}`);
  }

  if (r.newDecisions.length > 0) {
    const items = r.newDecisions.map((d) => {
      const line = `  - ${d.topic} (by ${d.from}): ${d.decision}`;
      return d.rationale ? `${line}\n${indent(`why: ${d.rationale}`, 4)}` : line;
    });
    sections.push(
      `NEW TEAM DECISIONS (${r.newDecisions.length}) - appended to your decisions file\n${items.join("\n")}`,
    );
  }

  if (r.notes.length > 0) {
    const items = r.notes.map((n) => `  - ${n.from}: ${n.text}`);
    sections.push(`NOTES (${r.notes.length})\n${items.join("\n")}`);
  }

  const waiting =
    r.awaitingReplies.length > 0
      ? "STILL WAITING ON:\n" +
        r.awaitingReplies
          .map(
            (w) =>
              `  [${w.cid}] you asked ${w.to.join(", ")} (${w.waitingHours}h ago): ${w.question}`,
          )
          .join("\n")
      : "";

  const scanLine = summariseScan(r);

  if (r.empty) {
    const head = "team_sync - nothing needs your attention right now.";
    return [head, waiting, scanLine].filter(Boolean).join("\n\n");
  }

  const head = `team_sync - ${attentionCount(r)} thing(s) need you`;
  return [head, sections.join("\n\n"), waiting, scanLine].filter(Boolean).join("\n\n");
}

function attentionCount(r: SyncResult): number {
  return r.questionsForMe.length + r.answersForMe.length + r.newDecisions.length + r.notes.length;
}

function summariseScan(r: SyncResult): string {
  const parts = [`scanned ${r.scannedMessages} new message(s)`];
  const dropped = r.droppedUnknownSender + r.droppedSenderMismatch;
  if (dropped > 0) {
    parts.push(
      `dropped ${dropped} (${r.droppedUnknownSender} unknown sender, ${r.droppedSenderMismatch} name mismatch)`,
    );
  }
  return parts.join(" · ");
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}
