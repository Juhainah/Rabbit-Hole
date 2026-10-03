// After a new version goes live, an open tab still asks for the old version's files, which are gone.
// Reloading once picks up the new version; a short guard stops a reload loop if something else is wrong.

const KEY = 'rh-reloaded-for-update';

/** True for the errors a missing old file causes. */
export const isStaleChunk = (message: string) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk \S+ failed/i.test(message);

/** Reloads the page onto the new version (at most once a minute). Returns false if it just did. */
export function reloadForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage off: still reload once */
  }
  location.reload();
  return true;
}
