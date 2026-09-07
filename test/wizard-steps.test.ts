import { describe, expect, it } from "vitest";
import {
  addTeammate,
  inviteUrl,
  reviewItems,
  toTeamFile,
  validateName,
  validateSnowflake,
  type WizardState,
} from "../src/cli/wizard/steps.js";

const BASE: WizardState = {
  me: "alice",
  token: "MTU0Njxx.SECRETVALUE.xxYY",
  botId: "1546373827578167447",
  botName: "alice-bot",
  guildId: "1546378169022677092",
  guildName: "team",
  channelId: "1546378169722994720",
  channelName: "general",
  teammates: [{ name: "alice", id: "1546373827578167447" }],
};

describe("validateName", () => {
  it("accepts a normal name", () => {
    expect(validateName("alice")).toBe(true);
  });

  it("rejects empty, spaced, and over-long names with a readable reason", () => {
    expect(typeof validateName("")).toBe("string");
    expect(typeof validateName("two words")).toBe("string");
    expect(typeof validateName("a".repeat(33))).toBe("string");
  });
});

describe("validateSnowflake", () => {
  it("accepts a Discord id", () => {
    expect(validateSnowflake("1546373827578167447")).toBe(true);
  });

  it("rejects short and non-numeric input", () => {
    expect(typeof validateSnowflake("123")).toBe("string");
    expect(typeof validateSnowflake("not-an-id")).toBe("string");
  });
});

describe("addTeammate", () => {
  it("adds a teammate", () => {
    const res = addTeammate(BASE, "bob", "1546381319724859412");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.teammates).toHaveLength(2);
  });

  it("lowercases the name", () => {
    const res = addTeammate(BASE, "BOB", "1546381319724859412");
    if (!res.ok) throw new Error(res.reason);
    expect(res.state.teammates[1]?.name).toBe("bob");
  });

  it("refuses a duplicate name regardless of case", () => {
    const res = addTeammate(BASE, "ALICE", "1546381319724859412");
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("already") });
  });

  it("refuses a duplicate bot id, which would break authorship routing", () => {
    const res = addTeammate(BASE, "bob", BASE.botId);
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("id") });
  });

  it("refuses an invalid name or id", () => {
    expect(addTeammate(BASE, "two words", "1546381319724859412").ok).toBe(false);
    expect(addTeammate(BASE, "bob", "123").ok).toBe(false);
  });

  it("does not mutate the input state", () => {
    addTeammate(BASE, "bob", "1546381319724859412");
    expect(BASE.teammates).toHaveLength(1);
  });
});

describe("inviteUrl", () => {
  it("carries the three permissions the relay needs", () => {
    expect(inviteUrl("123")).toBe(
      "https://discord.com/oauth2/authorize?client_id=123&permissions=68608&scope=bot",
    );
  });
});

describe("reviewItems", () => {
  it("summarises every editable value and never shows the token", () => {
    const items = reviewItems(BASE);
    expect(items.map((i) => i.id)).toEqual(["me", "token", "channel", "teammates"]);
    expect(JSON.stringify(items)).not.toContain(BASE.token);
    expect(items.find((i) => i.id === "channel")?.value).toContain("#general");
  });

  it("says so when nobody else is on the roster", () => {
    expect(reviewItems(BASE).find((i) => i.id === "teammates")?.value).toContain("none");
  });
});

describe("toTeamFile", () => {
  it("produces the config the server reads", () => {
    expect(toTeamFile(BASE)).toEqual({
      me: "alice",
      channelId: "1546378169722994720",
      teammates: [{ name: "alice", id: "1546373827578167447" }],
      decisionsFile: "TEAM-DECISIONS.md",
      transport: "discord",
    });
  });
});
