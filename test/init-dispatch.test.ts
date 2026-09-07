import { describe, expect, it } from "vitest";
import { chooseMode } from "../src/cli/init.js";

describe("chooseMode", () => {
  it("uses the wizard on a terminal", () => {
    expect(chooseMode(true)).toBe("wizard");
  });

  it("falls back to plain prompts when stdin is not a TTY", () => {
    expect(chooseMode(false)).toBe("plain");
  });
});
