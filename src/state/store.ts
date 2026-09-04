import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { AckPayloadSchema, AnswerPayloadSchema, QuestionPayloadSchema } from "../core/types.js";
import { log } from "../logger.js";

/**
 * Local, per-machine state. The channel is the source of truth for message
 * content; this file only tracks what THIS teammate has already seen and acted
 * on, so nothing is delivered twice and nothing is silently dropped.
 */

const StoredConversationSchema = z.object({
  cid: z.string(),
  question: QuestionPayloadSchema,
  answers: z.array(AnswerPayloadSchema),
  acks: z.array(AckPayloadSchema),
  firstSeenAt: z.string(),
  lastActivityAt: z.string(),
});

export type StoredConversation = z.infer<typeof StoredConversationSchema>;

const LocalStateSchema = z.object({
  version: z.literal(1),
  cursor: z.string().nullable(),
  conversations: z.record(z.string(), StoredConversationSchema),
  recordedDecisionIds: z.array(z.string()),
  shownNoteIds: z.array(z.string()),
});

export type LocalState = z.infer<typeof LocalStateSchema>;

function emptyState(): LocalState {
  return {
    version: 1,
    cursor: null,
    conversations: {},
    recordedDecisionIds: [],
    shownNoteIds: [],
  };
}

export class Store {
  private readonly path: string;
  private state: LocalState;

  private constructor(path: string, state: LocalState) {
    this.path = path;
    this.state = state;
  }

  static open(configDir: string): Store {
    const path = join(configDir, "state.json");
    let state = emptyState();
    try {
      const parsed = LocalStateSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
      if (parsed.success) {
        state = parsed.data;
      } else {
        log.warn(`state file at ${path} is invalid; starting fresh`, parsed.error.issues);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn(
          `could not read state file at ${path}; starting fresh (${(err as Error).message})`,
        );
      }
    }
    return new Store(path, state);
  }

  /** In-memory store for tests. */
  static ephemeral(): Store {
    return new Store("", emptyState());
  }

  get data(): LocalState {
    return this.state;
  }

  mutate(fn: (s: LocalState) => void): void {
    fn(this.state);
    this.persist();
  }

  private persist(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
      renameSync(tmp, this.path);
    } catch (err) {
      log.error(`failed to write state file at ${this.path}`, err);
    }
  }
}
