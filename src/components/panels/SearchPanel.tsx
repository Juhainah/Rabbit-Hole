import clsx from 'clsx';
import { ArrowDown, BookOpen, ExternalLink, Pin, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SOURCE_GROUPS, SOURCES, sourceMeta } from '../../../shared/sources';
import type { SourceItem } from '../../../shared/types';
import { api } from '../../lib/api';
import { pinItem, startDig } from '../../lib/dig';
import { prettyDate } from '../../lib/utils';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { Glyph } from '../SourceBadge';

type Result = { status: 'loading' | 'done' | 'error'; items: SourceItem[]; error?: string };

function ResultCard({ item }: { item: SourceItem }) {
  const selected = useUi((s) => s.selectedNodeId);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-rabbithole', JSON.stringify(item));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className="group flex cursor-grab gap-3 rounded-lg bg-[#fffdf7] p-2.5 shadow-[0_2px_6px_-3px_rgba(0,0,0,.3)] transition hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing"
    >
      {item.image && <img src={item.image} alt="" className="size-[62px] shrink-0 rounded object-cover" loading="lazy" draggable={false} />}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold leading-snug text-ink line-clamp-2">{item.title}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-ink-soft">
          {item.date && <span>{prettyDate(item.date)}</span>}
          {item.author && <span className="truncate max-w-[140px]">{item.author}</span>}
          {item.meta &&
            Object.entries(item.meta)
              .slice(0, 2)
              .map(([k, v]) => (
                <span key={k}>
                  {k} {String(v).slice(0, 20)}
                </span>
              ))}
        </div>
        {item.snippet && <p className="mt-1 text-[12px] leading-snug text-ink/75 line-clamp-2">{item.snippet}</p>}
        <div className="mt-1.5 flex gap-1 opacity-60 transition group-hover:opacity-100">
          <button className="clue-btn" onClick={() => pinItem(item, { near: selected })} title="Pin to board">
            <Pin size={11} className="inline -mt-0.5" /> Pin
          </button>
          <button className="clue-btn" onClick={() => void startDig({ query: item.title, parentId: selected })} title="Dig into this">
            <ArrowDown size={11} className="inline -mt-0.5" /> Dig
          </button>
          {item.url && (
            <button className="clue-btn" onClick={() => { useUi.getState().set({ readerUrl: item.url }); useUi.getState().openTab('read'); }}>
              <BookOpen size={11} className="inline -mt-0.5" /> Read
            </button>
          )}
          {item.url && (
            <a className="clue-btn" href={item.url} target="_blank" rel="noreferrer">
              <ExternalLink size={11} className="inline -mt-0.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function SearchPanel({ available }: { available: string[] }) {
  const selected = useSettings((s) => s.searchSources);
  const setPrefs = useSettings((s) => s.set);
  const prefill = useUi((s) => s.searchPrefill);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Record<string, Result>>({});
  const [showAll, setShowAll] = useState(false);
  const run = useRef(0);

  const sources = useMemo(() => SOURCES.filter((s) => !available.length || available.includes(s.id)), [available]);

  const search = (query: string) => {
    const v = query.trim();
    if (!v) return;
    const token = ++run.current;
    const ids = selected.filter((id) => sources.some((s) => s.id === id));
    setResults(Object.fromEntries(ids.map((id) => [id, { status: 'loading', items: [] }])));
    for (const id of ids) {
      api
        .search(id, v, 8)
        .then((items) => run.current === token && setResults((r) => ({ ...r, [id]: { status: 'done', items } })))
        .catch((e) => run.current === token && setResults((r) => ({ ...r, [id]: { status: 'error', items: [], error: e.message } })));
    }
  };

  useEffect(() => {
    if (!prefill) return;
    setQ(prefill.q);
    search(prefill.q);
  }, [prefill?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroup = (g: string) => {
    const ids = sources.filter((s) => s.group === g).map((s) => s.id);
    const allOn = ids.every((id) => selected.includes(id));
    setPrefs({ searchSources: allOn ? selected.filter((x) => !ids.includes(x)) : [...new Set([...selected, ...ids])] });
  };
  const toggle = (id: string) => setPrefs({ searchSources: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });

  const ordered = Object.entries(results).sort(([, a], [, b]) => (a.status === 'loading' ? 1 : 0) - (b.status === 'loading' ? 1 : 0) || b.items.length - a.items.length);
  const total = ordered.reduce((s, [, r]) => s + r.items.length, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink/10 px-4 pt-4 pb-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search(q);
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the archives…"
            className="min-w-0 flex-1 rounded-lg border border-ink/15 bg-white px-3 py-2 text-[13.5px] outline-none focus:border-ink/40"
          />
          <button className="btn-stamp px-3" title="Search">
            <Search size={16} />
          </button>
        </form>
        <div className="mt-2.5 flex flex-wrap gap-1">
          {SOURCE_GROUPS.map((g) => {
            const ids = sources.filter((s) => s.group === g).map((s) => s.id);
            if (!ids.length) return null;
            const on = ids.filter((id) => selected.includes(id)).length;
            return (
              <button key={g} onClick={() => toggleGroup(g)} className={clsx('chip !py-0.5 !text-[11.5px]', on === ids.length && 'on', on > 0 && on < ids.length && '!bg-paper-3')}>
                {g}
                {on > 0 && <span className="opacity-60">{on}</span>}
              </button>
            );
          })}
          <button onClick={() => setShowAll((v) => !v)} className="chip !py-0.5 !text-[11.5px] !border-dashed">
            {showAll ? 'less' : `pick sources (${selected.length})`}
          </button>
        </div>
        {showAll && (
          <div className="mt-2 max-h-[220px] overflow-y-auto rounded-lg bg-white/60 p-2">
            {SOURCE_GROUPS.map((g) => (
              <div key={g} className="mb-2">
                <div className="label-caps text-ink-soft">{g}</div>
                <div className="mt-1 grid gap-0.5">
                  {sources
                    .filter((s) => s.group === g)
                    .map((s) => (
                      <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12.5px] hover:bg-paper-2">
                        <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} className="accent-[#c8322f]" />
                        <Glyph id={s.id} />
                        <span className="font-medium">{s.name}</span>
                        <span className="truncate text-[11px] text-ink-soft">{s.description}</span>
                      </label>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!ordered.length && (
          <div className="pt-8 text-center">
            <div className="font-hand text-[26px] leading-none">The archive room</div>
            <p className="mx-auto mt-2 max-w-[290px] text-[13px] leading-relaxed text-ink-soft">
              {sources.length} sources: encyclopedias, museums, declassified files, old newspapers, forums, video, the weird corners of the web. Drag any result onto the board.
            </p>
          </div>
        )}
        {ordered.length > 0 && <div className="mb-2 font-hand text-[18px] text-ink-soft">{total} finds</div>}
        {ordered.map(([id, r]) => (
          <section key={id} className="mb-4">
            <div className="mb-1.5 flex items-center gap-2">
              <Glyph id={id} />
              <span className="text-[12.5px] font-semibold">{sourceMeta(id).name}</span>
              <span className="text-[11px] text-ink-soft">
                {r.status === 'loading' ? <span className="shovel-dots">searching</span> : r.status === 'error' ? 'unavailable right now' : `${r.items.length}`}
              </span>
            </div>
            <div className="grid gap-2">
              {r.items.map((it) => (
                <ResultCard key={it.id} item={it} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
