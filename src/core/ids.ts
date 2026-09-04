import { randomInt } from "node:crypto";

// Crockford-ish alphabet: no l/o to avoid confusion with 1/0, no vowels except
// what's left so ids rarely spell words.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function token(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/** Conversation id, e.g. `k7m2p9qd`. */
export function conversationId(): string {
  return token(8);
}

/** Decision id, e.g. `d4h9x2r`. */
export function decisionId(): string {
  return `d${token(7)}`;
}
