import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../logger.js";
import type { DecisionPayload } from "./types.js";

const HEADER = `# Team decisions

Maintained by team-relay-mcp. Each teammate's Claude appends here as decisions
are recorded, and reads this file for shared context at the start of a session.
`;

/**
 * Append decisions that are not already in the file. Returns the ids actually
 * written. Dedup is by the `<!-- did:... -->` marker so re-runs are safe even
 * if local state was lost.
 */
export function syncDecisionsFile(file: string, decisions: DecisionPayload[]): string[] {
  if (decisions.length === 0) return [];

  let body = "";
  try {
    body = existsSync(file) ? readFileSync(file, "utf8") : "";
  } catch (err) {
    log.warn(`could not read decisions file at ${file}`, err);
    return [];
  }

  const written: string[] = [];
  let toAppend = "";
  for (const d of decisions) {
    if (body.includes(`did:${d.did}`)) continue;
    toAppend += renderDecision(d);
    written.push(d.did);
  }
  if (toAppend === "") return [];

  try {
    mkdirSync(dirname(file), { recursive: true });
    if (body === "") {
      writeFileSync(file, `${HEADER}${toAppend}`, "utf8");
    } else {
      appendFileSync(file, toAppend, "utf8");
    }
  } catch (err) {
    log.error(`could not write decisions file at ${file}`, err);
    return [];
  }

  return written;
}

function renderDecision(d: DecisionPayload): string {
  const date = d.ts.slice(0, 10);
  const lines = ["", `## ${date} — ${d.topic}`, `<!-- did:${d.did} -->`, "", d.decision];
  if (d.rationale) {
    lines.push("", `**Why:** ${d.rationale}`);
  }
  lines.push("", `_recorded by ${d.from}_`, "");
  return lines.join("\n");
}
