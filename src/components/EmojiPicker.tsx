import clsx from 'clsx';
import { Dices, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_EMOJIS, EMOJI_GROUPS, type EmojiGroup } from '../lib/emojis';
import { loadAllEmojis } from '../lib/emojiAll';
import { useBoards } from '../store/boards';
import { useUi } from '../store/ui';

const RECENT_KEY = 'rh-recent-emoji';
const W = 324;
const H = 384;

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]').slice(0, 8);
  } catch {
    return [];
  }
}

/** Picks the icon for a board. Opened from the sidebar list or a case folder. */
export function EmojiPicker() {
  const target = useUi((s) => s.emojiFor);
  const current = useBoards((s) => (target ? s.boards[target.boardId]?.emoji : undefined));
  const [q, setQ] = useState('');
  const [group, setGroup] = useState(EMOJI_GROUPS[0].name);
  // Every other emoji, loaded the first time the picker opens.
  const [more, setMore] = useState<EmojiGroup[]>([]);
  const groups = useMemo(() => [...EMOJI_GROUPS, ...more], [more]);
  const box = useRef<HTMLDivElement>(null);

  const close = () => useUi.getState().set({ emojiFor: undefined });

  useEffect(() => {
    if (!target) return;
    setQ('');
    loadAllEmojis().then(setMore, () => {});
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [target]);

  const results = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    // The hand-picked ones first, then every other emoji with a matching word; each emoji once.
    const seen = new Set<string>();
    const hits = [...ALL_EMOJIS, ...more.flatMap((g) => g.items)].filter(
      ([e, w]) => (e === q.trim() || words.every((word) => w.split(' ').some((x) => x.startsWith(word)))) && !seen.has(e) && !!seen.add(e),
    );
    // Ones named by the word ("dog face") before ones merely tagged with it (a bone).
    const named = ([, w]: [string, string]) => (w.split(' ')[0].startsWith(words[0]) ? 0 : 1);
    return hits.map((h, i) => ({ h, i })).sort((a, b) => named(a.h) - named(b.h) || a.i - b.i).map((x) => x.h);
  }, [q, more]);

  if (!target) return null;

  const pick = (emoji: string) => {
    useBoards.getState().setEmoji(target.boardId, emoji);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, 8)));
    } catch {
      /* recent list just won't be remembered */
    }
    close();
  };

  const recent = readRecent();
  const shown = results ?? (groups.find((g) => g.name === group) ?? groups[0]).items;
  const left = Math.min(Math.max(8, target.x - 20), window.innerWidth - W - 8);
  const top = target.y + H + 12 > window.innerHeight ? Math.max(8, target.y - H - 12) : target.y + 12;

  return (
    <div ref={box} role="dialog" aria-label="Choose an icon" className="emoji-picker paper-panel animate-rise fixed z-[70] flex flex-col rounded-xl" style={{ left, top, width: W, height: H }}>
      <div className="flex items-center gap-2 border-b border-ink/10 p-2.5">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-ink/15 bg-white px-2.5 py-1.5">
          <Search size={14} className="shrink-0 text-ink-soft" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && results?.[0] && pick(results[0][0])}
            placeholder="Search any emoji: a word like ghost, food, dog…"
            className="min-w-0 flex-1 bg-transparent font-ui text-[13.5px] text-ink outline-none placeholder:text-ink/40"
          />
        </label>
        <button
          onClick={() => pick(ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)][0])}
          className="rounded-lg border border-ink/15 bg-white p-1.5 text-ink-soft transition hover:rotate-12 hover:text-ink"
          title="Surprise me"
        >
          <Dices size={17} />
        </button>
      </div>

      {!results && (
        <div className="flex gap-1 overflow-x-auto border-b border-ink/10 px-2.5 py-2 [scrollbar-width:none]">
          {groups.map((g) => (
            <button key={g.name} onClick={() => setGroup(g.name)} className={clsx('chip shrink-0 !px-2 !py-0.5 !text-[12px]', g.name === group && 'on')} title={g.name}>
              {g.items[0][0]} {g.name}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        {!results && recent.length > 0 && (
          <>
            <div className="label-caps mb-1 text-ink-soft">Recent</div>
            <div className="mb-2 grid grid-cols-8 gap-0.5">
              {recent.map((e) => (
                <EmojiButton key={e} emoji={e} on={e === current} onPick={pick} />
              ))}
            </div>
            <div className="label-caps mb-1 text-ink-soft">{group}</div>
          </>
        )}
        {shown.length ? (
          <div className="grid grid-cols-8 gap-0.5">
            {shown.map(([e, words]) => (
              <EmojiButton key={e} emoji={e} title={words.split(' ')[0]} on={e === current} onPick={pick} />
            ))}
          </div>
        ) : (
          <div className="px-2 py-6 text-center font-ui text-[13px] text-ink-soft">Nothing called “{q}”. Try another word, or roll the dice.</div>
        )}
      </div>
    </div>
  );
}

function EmojiButton({ emoji, title, on, onPick }: { emoji: string; title?: string; on?: boolean; onPick: (e: string) => void }) {
  return (
    <button onClick={() => onPick(emoji)} title={title} className={clsx('emoji-cell grid aspect-square place-items-center rounded-lg text-[22px]', on && 'on')}>
      {emoji}
    </button>
  );
}

/** Opens the picker next to whatever was clicked. */
export function openEmojiPicker(boardId: string, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  useUi.getState().set({ emojiFor: { boardId, x: r.left, y: r.bottom } });
}
