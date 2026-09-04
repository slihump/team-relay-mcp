import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/state/store.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "team-relay-store-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Store", () => {
  it("starts empty and persists mutations across reopen", () => {
    const s = Store.open(dir);
    expect(s.data.cursor).toBeNull();

    s.mutate((state) => {
      state.cursor = "000000000042";
      state.recordedDecisionIds.push("d1");
    });

    const reopened = Store.open(dir);
    expect(reopened.data.cursor).toBe("000000000042");
    expect(reopened.data.recordedDecisionIds).toEqual(["d1"]);
  });

  it("writes atomically (valid JSON on disk after mutate)", () => {
    const s = Store.open(dir);
    s.mutate((state) => {
      state.cursor = "x";
    });
    const onDisk = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    expect(onDisk.version).toBe(1);
    expect(onDisk.cursor).toBe("x");
  });

  it("recovers from a corrupt state file", () => {
    writeFileSync(join(dir, "state.json"), "{ not json", "utf8");
    const s = Store.open(dir);
    expect(s.data.cursor).toBeNull();
    expect(s.data.conversations).toEqual({});
  });

  it("ephemeral store never touches disk", () => {
    const s = Store.ephemeral();
    s.mutate((state) => {
      state.cursor = "mem";
    });
    expect(s.data.cursor).toBe("mem");
  });
});
