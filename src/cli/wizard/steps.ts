import type { TeamFile } from "../../config.js";
import { nameKey } from "../../core/types.js";

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const SNOWFLAKE_RE = /^\d{15,25}$/;

/** VIEW_CHANNEL (1024) + SEND_MESSAGES (2048) + READ_MESSAGE_HISTORY (65536). */
const INVITE_PERMISSIONS = 68608;

export interface WizardState {
  me: string;
  token: string;
  botId: string;
  botName: string;
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  teammates: { name: string; id: string }[];
}

export type ReviewKey = "me" | "token" | "channel" | "teammates";

export function validateName(raw: string): true | string {
  const v = raw.trim();
  if (!v) return "Required.";
  if (!NAME_RE.test(v)) return "Letters, digits, - and _ only; max 32, must start alphanumeric.";
  return true;
}

export function validateSnowflake(raw: string): true | string {
  const v = raw.trim();
  if (!v) return "Required.";
  if (!SNOWFLAKE_RE.test(v)) return "A Discord id is 15-25 digits.";
  return true;
}

export function addTeammate(
  state: WizardState,
  name: string,
  id: string,
): { ok: true; state: WizardState } | { ok: false; reason: string } {
  const nameCheck = validateName(name);
  if (nameCheck !== true) return { ok: false, reason: nameCheck };
  const idCheck = validateSnowflake(id);
  if (idCheck !== true) return { ok: false, reason: idCheck };

  const clean = name.trim().toLowerCase();
  const cleanId = id.trim();
  if (state.teammates.some((t) => nameKey(t.name) === nameKey(clean)))
    return { ok: false, reason: `"${clean}" is already on the roster.` };
  // Two teammates sharing a bot id would make inbound authorship ambiguous.
  if (state.teammates.some((t) => t.id === cleanId))
    return { ok: false, reason: "That bot id is already on the roster." };

  return {
    ok: true,
    state: { ...state, teammates: [...state.teammates, { name: clean, id: cleanId }] },
  };
}

export function inviteUrl(botId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${botId}&permissions=${INVITE_PERMISSIONS}&scope=bot`;
}

export function reviewItems(state: WizardState): { id: ReviewKey; label: string; value: string }[] {
  const others = state.teammates.filter((t) => nameKey(t.name) !== nameKey(state.me));
  return [
    { id: "me", label: "Your name", value: state.me },
    { id: "token", label: "Bot", value: `${state.botName} (${state.botId})` },
    { id: "channel", label: "Channel", value: `#${state.channelName} in ${state.guildName}` },
    {
      id: "teammates",
      label: "Teammates",
      value: others.length > 0 ? others.map((t) => t.name).join(", ") : "none yet",
    },
  ];
}

export function toTeamFile(state: WizardState): TeamFile {
  return {
    me: state.me,
    channelId: state.channelId,
    teammates: state.teammates,
    decisionsFile: "TEAM-DECISIONS.md",
    transport: "discord",
  };
}
