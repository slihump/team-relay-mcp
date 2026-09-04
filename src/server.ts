import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { formatSync } from "./format.js";
import { log } from "./logger.js";
import { Relay, RelayError } from "./relay.js";

const VERSION = "1.0.0";

function ok(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** Run a tool body, turning RelayError into a readable tool error the model can recover from. */
async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RelayError) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
    log.error("tool call failed", err);
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `team-relay error: ${message}` }] };
  }
}

export function createServer(cfg: Config, relay: Relay): McpServer {
  const server = new McpServer({ name: "team-relay", version: VERSION });

  const others = cfg.teammates
    .map((t) => t.name)
    .filter((n) => n.toLowerCase() !== cfg.me.toLowerCase());

  server.registerTool(
    "team_sync",
    {
      title: "Sync with the team channel",
      description:
        "Catch up on the shared team channel: questions from teammates that you need to answer, " +
        "answers to questions you asked, and new team decisions. Call this at the start of every " +
        "session and again after finishing a unit of work. Unanswered questions keep reappearing " +
        "here until you reply, so nothing is lost.",
      inputSchema: {},
    },
    () => guard(async () => ok(formatSync(await relay.sync()))),
  );

  server.registerTool(
    "ask_teammate",
    {
      title: "Ask a specific teammate",
      description:
        `Send a question to one teammate (${others.join(", ") || "no teammates configured"}). ` +
        "Use this when you hit something only they — or their local copy of the code — can answer: " +
        "an interface they own, a decision that's theirs to make, why their module does something. " +
        "Their Claude Code session picks it up on its next team_sync. Do not send code or file " +
        "contents unless the user has approved it.",
      inputSchema: {
        to: z.string().describe(`Teammate name. One of: ${others.join(", ")}`),
        question: z.string().describe("The question. Be specific and self-contained."),
        context: z
          .string()
          .optional()
          .describe("Optional background the teammate needs to answer well."),
      },
    },
    ({ to, question, context }) =>
      guard(async () => {
        const { cid, recipients } = await relay.ask({ to, question, context });
        return ok(
          `Sent to ${recipients.join(", ")}. conversation_id=${cid}\n` +
            "Their answer will show up in your next team_sync.",
        );
      }),
  );

  server.registerTool(
    "ask_team",
    {
      title: "Ask the whole team",
      description:
        "Broadcast a question to every teammate. Use for things anyone might answer: conventions, " +
        '"is anyone else touching X?", "does this break your part?". For a question aimed at one ' +
        "person, use ask_teammate instead.",
      inputSchema: {
        question: z.string().describe("The question to broadcast."),
        context: z.string().optional().describe("Optional background."),
      },
    },
    ({ question, context }) =>
      guard(async () => {
        const { cid, recipients } = await relay.ask({ question, context, broadcast: true });
        return ok(`Broadcast to ${recipients.join(", ")}. conversation_id=${cid}`);
      }),
  );

  server.registerTool(
    "reply",
    {
      title: "Answer a teammate's question",
      description:
        "Reply to a question from team_sync. Answer from THIS repository's actual code and files — " +
        "cite paths. If you don't know, say so and say what you'd need to find out. The asker sees " +
        "this on their next team_sync.",
      inputSchema: {
        conversation_id: z.string().describe("The [id] shown in team_sync."),
        answer: z.string().describe("Your answer."),
      },
    },
    ({ conversation_id, answer }) =>
      guard(async () => {
        const { to } = await relay.reply({ cid: conversation_id, answer });
        return ok(`Answer sent to ${to} (${conversation_id}).`);
      }),
  );

  server.registerTool(
    "ack",
    {
      title: "Acknowledge an answer",
      description:
        "Mark a question you asked as resolved once a teammate's answer settles it. This stops it " +
        "reappearing in your team_sync. If the answer wasn't enough, use reply to follow up instead.",
      inputSchema: {
        conversation_id: z.string().describe("The conversation id you asked about."),
        note: z.string().optional().describe("Optional short thanks / outcome note."),
      },
    },
    ({ conversation_id, note }) =>
      guard(async () => {
        await relay.ack({ cid: conversation_id, note });
        return ok(`Acknowledged ${conversation_id}.`);
      }),
  );

  server.registerTool(
    "record_decision",
    {
      title: "Record a team decision",
      description:
        "Log a decision that affects teammates — an interface contract, a shared convention, a tech " +
        "choice, who owns what. It is posted to the channel and appended to the team decisions file " +
        "in every teammate's repo on their next team_sync. Be liberal about recording; it's cheap " +
        "and keeps everyone's context in sync.",
      inputSchema: {
        topic: z.string().describe("Short label, e.g. 'Error handling in the API layer'."),
        decision: z.string().describe("What was decided, stated plainly."),
        rationale: z.string().optional().describe("Why, if it isn't obvious."),
      },
    },
    ({ topic, decision, rationale }) =>
      guard(async () => {
        const { did } = await relay.recordDecision({ topic, decision, rationale });
        return ok(`Recorded (${did}) and written to ${cfg.decisionsFile}.`);
      }),
  );

  server.registerTool(
    "post_note",
    {
      title: "Post an FYI to the team",
      description:
        "Send a heads-up that doesn't need an answer: 'refactoring auth for the next hour, hold off " +
        "on that module', 'pushed the migration'. Teammates see it once in their next team_sync.",
      inputSchema: {
        text: z.string().describe("The note."),
        to: z
          .array(z.string())
          .optional()
          .describe("Optional: limit to specific teammates. Omit for the whole team."),
      },
    },
    ({ text, to }) =>
      guard(async () => {
        await relay.note({ text, to });
        return ok("Note posted.");
      }),
  );

  return server;
}

export { RelayError };
