/**
 * Time limits for one chat turn.
 *
 * The chat routes run with `maxDuration = 300`. Vercel kills the function after
 * that; the client then holds a body of keepalive padding without JSON and the
 * reply is lost. The model loop therefore stops early enough to save its answer.
 * No server-only imports: the chat client uses the same limit in its messages.
 */

/** Must match `maxDuration` in the chat routes (Next.js needs the literal there). */
export const DT_CHAT_ROUTE_MAX_DURATION_MS = 300_000;

/** Kept free after the model loop: save the reply, build and upload files, usage, chat title. */
export const DT_CHAT_AFTER_MODEL_RESERVE_MS = 40_000;

/** Time the model loop may use when the caller passes no deadline. */
export const DT_CHAT_MODEL_BUDGET_MS =
  DT_CHAT_ROUTE_MAX_DURATION_MS - DT_CHAT_AFTER_MODEL_RESERVE_MS;

/** Latest moment the model loop may still be working for a request that started at `requestStartedAt`. */
export function dtChatModelDeadline(requestStartedAt: number): number {
  return requestStartedAt + DT_CHAT_MODEL_BUDGET_MS;
}

/** "45 Sekunden", "4 Minuten": for messages about how long a turn ran. */
export function formatDtChatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds} Sekunden`;
  return `${Math.round(seconds / 60)} Minuten`;
}
