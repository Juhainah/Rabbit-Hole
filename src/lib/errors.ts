import { authEnabled, client, useAuth } from './auth';

// Errors in the browser go to the owner's error log (admin.errors, supabase/safety.sql),
// so a bug someone hits gets seen without them having to report it. Only the message,
// where in the code it happened, and the page address are sent.

const seen = new Set<string>();
// Not bugs in the app: browser extensions, dropped connections, cancelled requests.
const NOISE = /ResizeObserver loop|^Script error\.?$|extension:\/\/|Load failed|NetworkError|Failed to fetch|AbortError|aborted|Can't reach the Rabbit Hole server/i;

export function reportError(message: string, detail?: string) {
  if (!authEnabled || useAuth.getState().status !== 'signed-in') return;
  if (!message || NOISE.test(message) || seen.has(message) || seen.size >= 15) return;
  seen.add(message);
  void client()
    .then((sb) =>
      sb.rpc('log_error', {
        place: 'browser',
        message: message.slice(0, 500),
        detail: detail?.slice(0, 4000) ?? null,
        page: `${window.location.pathname}${window.location.search}`.slice(0, 120),
        version: navigator.userAgent.slice(0, 40),
      }),
    )
    .catch(() => undefined);
}

window.addEventListener('error', (e) => {
  if (e instanceof ErrorEvent && e.message) reportError(e.message, e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  const r: unknown = e.reason;
  reportError(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
});
