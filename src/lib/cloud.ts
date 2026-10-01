import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { settleBoard, useBoards } from '../store/boards';
import { useUi } from '../store/ui';
import type { Board, ClueNode, StringEdge } from '../types';
import { authEnabled, client, onBeforeSignOut, useAuth } from './auth';

// Boards live on this device (IndexedDB) and, once signed in, in the account too, so a
// cleared browser or a new phone doesn't lose them. Each board carries its own
// "last changed" clock; when two copies differ, the newer one wins.
// The table and its access rules are in supabase/boards.sql.

export type CloudState = 'off' | 'saving' | 'saved' | 'offline' | 'unavailable';
export const useCloud = create<{ state: CloudState }>(() => ({ state: 'off' }));
const setCloud = (state: CloudState) => useCloud.setState({ state });

const OWNERS = 'rh-board-owners';
/** Which account each board on this device belongs to, so one person's boards never upload into another's account. */
const owners: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(OWNERS) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
})();
function own(id: string, uid: string | null) {
  if (uid) owners[id] = uid;
  else delete owners[id];
  try {
    localStorage.setItem(OWNERS, JSON.stringify(owners));
  } catch {
    /* private window: ownership is kept for this visit only */
  }
}

let uid: string | undefined;
let sb: SupabaseClient | undefined;
const dirty = new Set<string>();
const removed = new Set<string>();
/** A cheap fingerprint of what was last saved per board, so a click that only selects a card isn't re-sent. */
const sent = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let firstChange = 0;
let saving: Promise<boolean> | null = null;
let pulling: Promise<void> | null = null;
let pullAgain = false;
let pulledAt = 0;
let applying = false;

const blank = (b: Board) => !b.nodes.length && !b.chat.length;

/** The board as saved: React Flow's passing selection and drag state stay on this device. */
function clean(b: Board): Board {
  return {
    ...b,
    nodes: b.nodes.map(({ selected: _s, dragging: _d, ...n }) => n as ClueNode),
    edges: b.edges.map(({ selected: _s, ...e }) => e as StringEdge),
  };
}

function fingerprint(b: Board) {
  const s = JSON.stringify({ ...b, updatedAt: 0 });
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${s.length}:${h >>> 0}`;
}

const missingTable = (e: PostgrestError) => e.code === 'PGRST205' || e.code === '42P01' || /does not exist|could not find the table/i.test(e.message);
const tooBig = (e: PostgrestError) => e.code === '23514' || /board_size|payload too large|request entity too large/i.test(e.message);

function failed(e: PostgrestError) {
  if (missingTable(e)) {
    console.warn('[cloud] The boards table is missing. Run supabase/boards.sql in the Supabase SQL editor to save boards online.');
    setCloud('unavailable');
    return;
  }
  console.warn('[cloud]', e.message);
  setCloud('offline');
  // Try again later; nothing is lost, the boards are still on this device.
  clearTimeout(timer);
  timer = setTimeout(() => void (pulledAt ? flush() : pull()), 30_000);
}

/** Brings this device and the account in line: newer copies come down, newer local ones go up. */
function pull(): Promise<void> {
  pulling ??= (async () => {
    if (!uid || !sb) return;
    setCloud('saving');
    const { data: rows, error } = await sb.from('boards').select('id,updated_at,deleted');
    if (error) return failed(error);
    pulledAt = Date.now();
    const local = useBoards.getState().boards;
    const remote = new Map(rows.map((r) => [r.id as string, r as { id: string; updated_at: number; deleted: boolean }]));

    const want = [...remote.values()].filter((r) => !r.deleted && (!local[r.id] || r.updated_at > local[r.id].updatedAt)).map((r) => r.id);
    const fetched: Board[] = [];
    for (let i = 0; i < want.length; i += 15) {
      const { data, error: e } = await sb.from('boards').select('id,data').in('id', want.slice(i, i + 15));
      if (e) return failed(e);
      for (const row of data) fetched.push(settleBoard({ ...(row.data as Board), id: row.id as string }));
    }
    const gone = [...remote.values()].filter((r) => r.deleted && local[r.id] && owners[r.id] === uid && local[r.id].updatedAt <= r.updated_at).map((r) => r.id);

    if (fetched.length || gone.length) {
      applying = true;
      useBoards.setState((s) => {
        const boards = { ...s.boards };
        let order = s.order.filter((id) => !gone.includes(id));
        for (const id of gone) delete boards[id];
        // A fresh device: its untouched starter board gives way to the account's boards.
        if (fetched.length && order.length === 1 && boards[order[0]] && blank(boards[order[0]]) && !remote.has(order[0])) {
          delete boards[order[0]];
          order = [];
        }
        const added = fetched.filter((b) => !order.includes(b.id)).sort((a, b) => b.updatedAt - a.updatedAt);
        for (const b of fetched) boards[b.id] = b;
        order = [...order, ...added.map((b) => b.id)];
        if (!order.length) return s;
        return { boards, order, currentId: boards[s.currentId] ? s.currentId : order[0] };
      });
      applying = false;
      for (const b of fetched) {
        own(b.id, uid);
        sent.set(b.id, fingerprint(clean(b)));
      }
    }

    // Boards that are only here, or newer here, go up.
    for (const b of Object.values(useBoards.getState().boards)) {
      const r = remote.get(b.id);
      if ((owners[b.id] ?? uid) === uid && !blank(b) && (!r || b.updatedAt > r.updated_at)) dirty.add(b.id);
    }
    if (dirty.size) await flush();
    else setCloud('saved');
  })().finally(() => {
    pulling = null;
    if (pullAgain) {
      pullAgain = false;
      void pull();
    }
  });
  return pulling;
}

/** Sends every changed board now. */
export async function flush(): Promise<void> {
  clearTimeout(timer);
  firstChange = 0;
  while (saving) await saving;
  if (!uid || !sb || useCloud.getState().state === 'unavailable' || (!dirty.size && !removed.size)) return;
  const account = uid;
  const db = sb;
  saving = (async () => {
    setCloud('saving');
    let trouble: PostgrestError | null = null;
    let newer = false;
    for (const id of [...dirty]) {
      dirty.delete(id);
      const b = useBoards.getState().boards[id];
      if (!b || blank(b) || (owners[id] ?? account) !== account) continue;
      const data = clean(b);
      const print = fingerprint(data);
      if (sent.get(id) === print) continue;
      const row = { user_id: account, id, name: b.name, emoji: b.emoji, data, updated_at: b.updatedAt, deleted: false };
      // Only ever replace an older copy: a stale tab must not overwrite what another device saved since.
      let { data: done, error } = await db.from('boards').update(row).eq('user_id', account).eq('id', id).lt('updated_at', b.updatedAt).select('id');
      if (!error && !done?.length) {
        ({ data: done, error } = await db.from('boards').upsert(row, { onConflict: 'user_id,id', ignoreDuplicates: true }).select('id'));
        // Already there and at least as new: that copy wins, so fetch it instead.
        if (!error && !done?.length) {
          newer = true;
          continue;
        }
      }
      if (error) {
        if (tooBig(error)) {
          console.warn(`[cloud] "${b.name}" is too big to save online; it stays on this device.`);
          continue;
        }
        trouble = error;
        dirty.add(id);
        if (missingTable(error)) break;
        continue;
      }
      sent.set(id, print);
      own(id, account);
    }
    for (const id of [...removed]) {
      removed.delete(id);
      // An empty marker stays behind, so another device doesn't bring the board back.
      const { error } = await db.from('boards').update({ deleted: true, data: {}, share_id: null, updated_at: Date.now() }).eq('user_id', account).eq('id', id);
      if (error) {
        trouble = error;
        removed.add(id);
        continue;
      }
      sent.delete(id);
      own(id, null);
    }
    if (trouble) failed(trouble);
    else setCloud('saved');
    return newer;
  })().finally(() => (saving = null));
  const stale = await saving;
  // Mid-pull (it called this flush), so ask it to go round again rather than wait on itself.
  if (stale && pulling) pullAgain = true;
  else if (stale) await pull();
  // Changes made while that save was running.
  if ((dirty.size || removed.size) && useCloud.getState().state === 'saved') schedule();
}

function schedule() {
  if (!dirty.size && !removed.size) return;
  const now = Date.now();
  firstChange ||= now;
  clearTimeout(timer);
  // Once things go quiet for a moment, or at least every 20 s while a dig keeps the board busy.
  timer = setTimeout(() => void flush(), Math.max(0, Math.min(2500, firstChange + 20_000 - now)));
}

useBoards.subscribe((s, prev) => {
  if (!uid || applying || s.boards === prev.boards) return;
  for (const id in s.boards) if (s.boards[id] !== prev.boards[id]) dirty.add(id);
  for (const id in prev.boards) {
    if (id in s.boards) continue;
    dirty.delete(id);
    if (owners[id] === uid) removed.add(id);
  }
  schedule();
});

async function connect(account: string) {
  // Wait until this device's boards have loaded, or they'd look missing.
  if (!useBoards.getState().hydrated) {
    await new Promise<void>((done) => {
      const stop = useBoards.subscribe((s) => {
        if (s.hydrated) {
          stop();
          done();
        }
      });
    });
  }
  sb = await client();
  uid = account;
  countVisit(account);
  await pull();
  await claimSharedCopy();
}

/** One visit a day per person, for the owner's usage numbers (admin.daily, admin.weekly). */
function countVisit(account: string) {
  const key = `${account}:${new Date().toISOString().slice(0, 10)}`;
  try {
    if (localStorage.getItem('rh-visit') === key) return;
  } catch {
    /* counted anyway */
  }
  void sb
    ?.rpc('take_hit', { bucket: 'visit' })
    .then(({ error }) => {
      if (!error) localStorage.setItem('rh-visit', key);
    });
}

function disconnect() {
  uid = undefined;
  pulledAt = 0;
  dirty.clear();
  removed.clear();
  sent.clear();
  clearTimeout(timer);
  setCloud('off');
}

if (authEnabled) {
  useAuth.subscribe((s, prev) => {
    if (s.uid === prev.uid) return;
    if (s.uid) void connect(s.uid);
    else disconnect();
  });
  const signedIn = useAuth.getState().uid;
  if (signedIn) void connect(signedIn);
  onBeforeSignOut(flush);
  window.addEventListener('online', () => void (uid && pull()));
  document.addEventListener('visibilitychange', () => {
    if (!uid) return;
    // Leaving the tab: save now. Coming back after a while: pick up changes made on another device.
    if (document.visibilityState === 'hidden') void flush();
    else if (Date.now() - pulledAt > 60_000) void pull();
  });
}

// ── Share links ──────────────────────────────────────────────────────────────

export const shareUrl = (sid: string) => `${window.location.origin}/?shared=${sid}`;

/** The board's share link if it has one. */
export async function sharedLink(id: string): Promise<string | null> {
  if (!uid || !sb) return null;
  const { data } = await sb.from('boards').select('share_id').eq('user_id', uid).eq('id', id).maybeSingle();
  return data?.share_id ? shareUrl(data.share_id as string) : null;
}

/** Saves the board as it is now and gives it a link anyone can view. */
export async function shareBoard(id: string): Promise<string> {
  const b = useBoards.getState().boards[id];
  if (!b || blank(b)) throw new Error('Pin something to this board first.');
  if (!uid || !sb) throw new Error('Sign in to share boards.');
  if (useCloud.getState().state === 'unavailable') throw new Error("Sharing isn't set up on this site yet.");
  sent.delete(id);
  dirty.add(id);
  await flush();
  const account = uid;
  const { data, error } = await sb.from('boards').select('share_id').eq('user_id', account).eq('id', id).maybeSingle();
  if (error || !data) throw new Error("Couldn't save the board online. Check your connection and try again.");
  if (data.share_id) return shareUrl(data.share_id as string);
  const sid = nanoid(16);
  const { error: e } = await sb.from('boards').update({ share_id: sid }).eq('user_id', account).eq('id', id);
  if (e) throw new Error("Couldn't make a link. Try again.");
  return shareUrl(sid);
}

/** Turns the link off; anyone who had it sees "no longer shared". */
export async function stopSharing(id: string) {
  if (!uid || !sb) return;
  const { error } = await sb.from('boards').update({ share_id: null }).eq('user_id', uid).eq('id', id);
  if (error) throw new Error("Couldn't turn the link off. Try again.");
}

/** Someone pressed "make a copy" on a shared board before signing in. */
export const COPY_LATER = 'rh-copy-shared';

async function claimSharedCopy() {
  let sid: string | null = null;
  try {
    sid = sessionStorage.getItem(COPY_LATER);
    sessionStorage.removeItem(COPY_LATER);
  } catch {
    return;
  }
  if (!sid) return;
  const board = await loadShared(sid).catch(() => null);
  if (!board) return;
  useBoards.getState().importBoard(board);
  useUi.getState().set({ toast: { text: `“${board.name}” is now on your boards`, at: Date.now() } });
}

/** Flags a shared board for the owner of the site to look at (admin.reports). */
export async function reportBoard(sid: string, reason: string, details: string) {
  const db = await client();
  const { data, error } = await db.rpc('report_board', { sid, reason, details: details.trim() || null });
  if (error || data !== true) throw new Error("Couldn't send the report. Try again in a moment.");
}

/** A shared board, for anyone with its link (signed in or not). */
export async function loadShared(sid: string): Promise<Board | null> {
  if (!authEnabled) throw new Error('Shared boards need the online version of Rabbit Hole.');
  const db = await client();
  const { data, error } = await db.rpc('shared_board', { sid });
  if (error) throw new Error(missingTable(error) || /function .* does not exist|could not find the function/i.test(error.message) ? "Sharing isn't set up on this site yet." : "Couldn't open this board. Check your connection and try again.");
  return data ? settleBoard(data as Board) : null;
}
