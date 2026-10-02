import { Dices, Hammer } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../../lib/api';
import { startDig } from '../../lib/dig';
import { TEMPLATES, startFromTemplate } from '../../lib/templates';
import { hash01 } from '../../lib/utils';

const CLASSICS = [
  'The Voynich Manuscript',
  'Numbers stations',
  'The Tamam Shud case',
  'Dancing plague of 1518',
  'Operation Paperclip',
  'The Wow! signal',
  'Kowloon Walled City',
  'The Max Headroom incident',
  'Cicada 3301',
  'Göbekli Tepe',
  'Toynbee tiles',
  'The Mary Celeste',
];

const SCRAP_COLORS = ['#fffdf7', '#f7de6b', '#f6c7b8', '#cfe3c4', '#cfe2ee'];

type Inspo = Awaited<ReturnType<typeof api.inspiration>>;

export function EmptyState() {
  const [q, setQ] = useState('');
  const [inspo, setInspo] = useState<Inspo | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ w: 0, h: 0, cw: 560, ch: 560 });

  // Measure the board and the case card so scraps only go where they stay visible.
  useEffect(() => {
    const measure = () => {
      const b = box.current?.getBoundingClientRect();
      const c = card.current?.getBoundingClientRect();
      if (b && c) setSpace({ w: b.width, h: b.height, cw: c.width, ch: c.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    if (card.current) ro.observe(card.current);
    return () => ro.disconnect();
  }, []);

  const scraps = CLASSICS.map((c, i) => {
    const a = (i / CLASSICS.length) * Math.PI * 2 + 0.3;
    const x = space.w / 2 + Math.cos(a) * (space.w / 2 - 105 - hash01(c) * 30);
    const y = space.h / 2 + Math.sin(a) * (space.h / 2 - 55 - hash01(`${c}y`) * 20);
    const clear = Math.abs(x - space.w / 2) > space.cw / 2 + 95 || Math.abs(y - space.h / 2) > space.ch / 2 + 30;
    return { c, i, x, y, clear };
  }).filter((s) => s.clear && space.w > 0);
  const tucked = CLASSICS.filter((c) => !scraps.some((s) => s.c === c));

  useEffect(() => {
    api.inspiration().then(setInspo).catch(() => undefined);
  }, []);

  const random = () => {
    const pool = inspo?.random ?? [];
    const pick = pool[Math.floor(Math.random() * pool.length)]?.title ?? CLASSICS[Math.floor(Math.random() * CLASSICS.length)];
    void startDig({ query: pick });
  };

  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-10 grid place-items-center overflow-hidden p-10">
      {/* scattered suggestion scraps, pinned around the case card where there is room */}
      {scraps.map(({ c, i, x, y }) => {
        return (
          <button
            key={c}
            onClick={() => void startDig({ query: c })}
            className="pointer-events-auto absolute px-3 pt-3 pb-2 font-hand text-[21px] leading-none text-ink shadow-[0_6px_14px_-6px_rgba(0,0,0,.5)] transition hover:z-10 hover:scale-110 hover:rotate-0"
            style={
              {
                left: x,
                top: y,
                translate: '-50% -50%',
                rotate: `${(hash01(`${c}r`) * 2 - 1) * 8}deg`,
                background: SCRAP_COLORS[i % SCRAP_COLORS.length],
                animation: `rise .5s ${i * 0.05}s both`,
              } as CSSProperties
            }
          >
            <span className="absolute left-1/2 top-[-5px] size-3 -translate-x-1/2 rounded-full bg-[#c8322f] shadow-[1px_3px_3px_rgba(0,0,0,.45)]" />
            {c}
          </button>
        );
      })}

      <div ref={card} className="pointer-events-auto relative w-[min(560px,92%)] rotate-[-1deg] animate-rise">
        <div className="absolute -top-[15px] left-[26px] h-[18px] w-[150px] rounded-t-lg bg-[#e8cf95]" />
        <div className="relative rounded-md bg-[linear-gradient(170deg,#efd9a6,#e3c78a)] p-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,.7)]">
          <div className="absolute left-1/2 -top-2 size-4 -translate-x-1/2 rounded-full bg-[#1f1f1f] shadow-[2px_4px_4px_rgba(0,0,0,.5)]" />
          <div className="bg-[#fbf7ee] px-7 pt-6 pb-6 shadow-sm">
            <div className="font-type text-[11px] tracking-[0.2em] text-ink-soft">CASE FILE Nº 000 · UNOPENED</div>
            <h1 className="mt-2 font-serif text-[40px] font-bold leading-[1.02] text-ink">
              What do you want to <span className="italic text-[#b3261e]">fall into?</span>
            </h1>
            <p className="mt-2 font-hand text-[21px] leading-tight text-ink-soft">
              Name a mystery, a person, a place, an obsession. We'll pull the files and start stringing it together.
            </p>
            <form
              className="mt-5 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!q.trim()) return;
                if (/^https?:\/\//.test(q.trim())) void startDig({ query: '', url: q.trim() });
                else void startDig({ query: q });
              }}
            >
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="the Dyatlov Pass incident… or paste a link"
                className="min-w-0 flex-1 border-b-2 border-dashed border-ink/30 bg-transparent px-1 py-2 font-type text-[17px] text-ink outline-none placeholder:text-ink/35 focus:border-[#b3261e]"
              />
              <button className="btn-stamp px-5 text-[15px]">DIG ↓</button>
            </form>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button onClick={random} className="chip on" title="Pick a strange article from Wikipedia's Unusual Articles list">
                <Dices size={14} /> Surprise me
              </button>
              {inspo?.random.slice(0, 3).map((r) => (
                <button key={r.title} className="chip" onClick={() => void startDig({ query: r.title })} title={r.snippet}>
                  {r.title}
                </button>
              ))}
            </div>
            {tucked.length > 0 && (
              <div className="mt-3">
                <div className="text-[11.5px] font-medium text-ink-soft">Classic rabbit holes</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {tucked.map((c) => (
                    <button key={c} className="chip" onClick={() => void startDig({ query: c })}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 border-t border-dashed border-ink/20 pt-3">
              <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-soft">
                <Hammer size={13} /> Or build your own board
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button className="chip" onClick={() => startFromTemplate('blank')} title="Start empty and add your own cards, photos and files">
                  Blank board
                </button>
                {TEMPLATES.map((t) => (
                  <button key={t.id} className="chip" onClick={() => startFromTemplate(t.id)} title={t.blurb}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {inspo?.onThisDay.length ? (
            <div className="mt-3 bg-[#f3eee2] px-5 py-3 shadow-sm rotate-[0.6deg]">
              <div className="font-serif text-[13px] font-bold uppercase tracking-[0.18em] text-ink border-b border-ink/30 pb-1">On this day</div>
              {inspo.onThisDay.slice(0, 3).map((e) => (
                <button key={e.text} onClick={() => void startDig({ query: e.title || e.text })} className="mt-1.5 block text-left text-[12.5px] leading-snug text-ink/85 hover:text-[#b3261e]">
                  <span className="font-type text-[#b3261e]">{e.year}</span> — {e.text}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
