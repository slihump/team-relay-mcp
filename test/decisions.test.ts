import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncDecisionsFile } from "../src/core/decisions.js";
import type { DecisionPayload } from "../src/core/types.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "team-relay-dec-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function decision(over: Partial<DecisionPayload> = {}): DecisionPayload {
  return {
    v: 1,
    t: "decision",
    did: "d1",
    from: "alice",
    topic: "zod version",
    decision: "pin to v3",
    ts: "2026-09-04T10:00:00.000Z",
    ...over,
  };
}

describe("syncDecisionsFile", () => {
  it("creates the file with a header, then appends", () => {
    const file = join(dir, "DECISIONS.md");

    expect(syncDecisionsFile(file, [decision()])).toEqual(["d1"]);
    let body = readFileSync(file, "utf8");
    expect(body).toContain("# Team decisions");
    expect(body).toContain("## 2026-09-04 — zod version");
    expect(body).toContain("pin to v3");

    expect(syncDecisionsFile(file, [decision({ did: "d2", topic: "logging" })])).toEqual(["d2"]);
    body = readFileSync(file, "utf8");
    expect(body).toContain("## 2026-09-04 — logging");
    expect((body.match(/# Team decisions/g) ?? []).length).toBe(1);
  });

  it("does not write a decision whose marker is already in the file", () => {
    const file = join(dir, "DECISIONS.md");
    syncDecisionsFile(file, [decision()]);
    expect(syncDecisionsFile(file, [decision()])).toEqual([]);
    const body = readFileSync(file, "utf8");
    expect((body.match(/pin to v3/g) ?? []).length).toBe(1);
  });

  it("includes the rationale when present", () => {
    const file = join(dir, "DECISIONS.md");
    syncDecisionsFile(file, [decision({ rationale: "SDK peer range" })]);
    expect(readFileSync(file, "utf8")).toContain("**Why:** SDK peer range");
  });

  it("returns [] and does not throw when the path is unwritable", () => {
    const blocker = join(dir, "not-a-dir");
    writeFileSync(blocker, "x");
    const file = join(blocker, "DECISIONS.md"); // parent is a file
    expect(syncDecisionsFile(file, [decision()])).toEqual([]);
  });
});
