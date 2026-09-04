/**
 * A transport moves opaque text messages in and out of one shared channel.
 * It knows nothing about questions, routing, or verification — that all lives
 * in the relay. Swapping Discord for an in-memory channel (tests) or, later,
 * Slack must not touch anything above this line.
 */

export interface RawMessage {
  /** Transport-native message id. Must sort chronologically as a string or be usable as a cursor. */
  id: string;
  /** Who posted it, as the transport sees them. `id` is the stable identity used for verification. */
  author: { id: string; name?: string };
  text: string;
  /** ISO 8601. */
  createdAt: string;
}

export interface FetchOptions {
  /** Soft cap on messages returned in one call. Transports may page internally up to this. */
  limit?: number;
}

export interface TeamTransport {
  /** This client's own stable identity on the transport (e.g. the bot's user id). */
  readonly selfId: string;

  /** Resolve when the transport is ready to send/fetch. Safe to call more than once. */
  connect(): Promise<void>;

  /** Post a message. Resolves with the stored message (including its new id). */
  send(text: string): Promise<RawMessage>;

  /**
   * Messages created strictly after `cursor`, oldest first. `null` cursor means
   * "recent history only" (transports decide how much) so a first run does not
   * replay an entire channel.
   */
  fetchSince(cursor: string | null, opts?: FetchOptions): Promise<RawMessage[]>;

  /** Release resources. Safe to call more than once. */
  close(): Promise<void>;
}
