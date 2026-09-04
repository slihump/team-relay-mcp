import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { nameKey } from "./core/types.js";

const TeammateSchema = z.object({
  name: z.string().min(1).max(64),
  id: z.string().min(1).max(128),
});

const TeamFileSchema = z.object({
  me: z.string().min(1).max(64),
  channelId: z.string().min(1).max(128),
  teammates: z.array(TeammateSchema).min(1).max(64),
  decisionsFile: z.string().min(1).default("TEAM-DECISIONS.md"),
  transport: z.enum(["discord", "memory"]).default("discord"),
});

export type TeamFile = z.infer<typeof TeamFileSchema>;
export type Teammate = z.infer<typeof TeammateSchema>;

export interface Config {
  me: string;
  channelId: string;
  teammates: Teammate[];
  /** transport id -> teammate name, for verifying inbound authorship. */
  rosterById: Map<string, string>;
  transport: "discord" | "memory";
  decisionsFile: string;
  configDir: string;
  discordToken: string | undefined;
}

export class ConfigError extends Error {}

/** Where team.json / state.json / .env live. */
export function resolveConfigDir(cwd = process.cwd()): string {
  const fromEnv = process.env.TEAM_RELAY_CONFIG_DIR;
  if (fromEnv) return resolve(cwd, fromEnv);
  const local = join(cwd, ".team-relay");
  if (existsSync(local)) return local;
  const home = join(homedir(), ".team-relay");
  if (existsSync(home)) return home;
  return local;
}

export function teamFilePath(configDir: string): string {
  return join(configDir, "team.json");
}

export function loadConfig(opts: { cwd?: string; configDir?: string } = {}): Config {
  const cwd = opts.cwd ?? process.cwd();
  const configDir = opts.configDir ?? resolveConfigDir(cwd);
  const file = teamFilePath(configDir);

  if (!existsSync(file)) {
    throw new ConfigError(
      `No team config found at ${file}.\nRun \`npx team-relay-mcp init\` to create one.`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new ConfigError(`${file} is not valid JSON: ${(err as Error).message}`);
  }

  const result = TeamFileSchema.safeParse(parsedJson);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`${file} is invalid:\n${detail}`);
  }
  const team = result.data;

  const nameKeys = team.teammates.map((t) => nameKey(t.name));
  if (new Set(nameKeys).size !== nameKeys.length) {
    throw new ConfigError(`${file}: teammate names must be unique (case-insensitive).`);
  }
  if (!nameKeys.includes(nameKey(team.me))) {
    throw new ConfigError(`${file}: "me" (${team.me}) is not listed in teammates.`);
  }

  const rosterById = new Map<string, string>();
  for (const t of team.teammates) rosterById.set(t.id, t.name);

  const decisionsFile = isAbsolute(team.decisionsFile)
    ? team.decisionsFile
    : resolve(cwd, team.decisionsFile);

  return {
    me: team.me,
    channelId: team.channelId,
    teammates: team.teammates,
    rosterById,
    transport: team.transport,
    decisionsFile,
    configDir,
    discordToken: process.env.DISCORD_BOT_TOKEN?.trim() || undefined,
  };
}

export { TeamFileSchema };
