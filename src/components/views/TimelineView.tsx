import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { nodeColor, prettyDate, TYPE_LABEL, yearOf } from '../../lib/utils';
import { useCurrentBoard } from '../../store/boards';
import { useUi } from '../../store/ui';
import type { ClueType } from '../../types';
import { Glyph } from '../SourceBadge';

interface Row {
  key: string;
  year: number;
  sort: string;
  date: string;
  title: string;
  sub?: string;
  color: string;
  nodeId?: string;
  source?: string;
  image?: string;
  clusterId?: string;
  /** When a source was published, as opposed to something that happened in the story. */
  published?: boolean;
}

// Cards whose date is when they were published, not when something happened.
const SOURCE_TYPES = new Set(['clip', 'post', 'video', 'image', 'quote']);

/** The story in order: what happened, case by case. Publication dates of sources are a separate, optional layer. */
export function TimelineView() {
  const board = useCurrentBoard();
  const [only, setOnly] = useState<string>();
  const [withSources, setWithSources] = useState(false);
  const cases = useMemo(() => board.nodes.filter((n) => n.type === 'topic').map((n) => ({ id: n.data.clusterId!, title: n.data.title })), [board.nodes]);
  const rows = useMemo(() => {
    const topicByCluster = new Map(board.nodes.filter((n) => n.type === 'topic').map((n) => [n.data.clusterId, n]));
    const out: Row[] = [];
    for (const t of board.timeline) {
      const y = yearOf(t.date);
      if (y == null) continue;
      const topic = topicByCluster.get(t.clusterId);
      out.push({ key: t.id, year: y, sort: t.date, date: t.date, title: t.event, sub: topic?.data.title, color: '#c8322f', nodeId: topic?.id, clusterId: t.clusterId });
    }
    for (const n of board.nodes) {
      const y = yearOf(n.data.date);
      if (y == null) continue;
      out.push({
        key: n.id,
        year: y,
        sort: n.data.date!,
        date: n.data.date!,
        title: n.data.title,
        sub: TYPE_LABEL[n.type as ClueType],
        color: nodeColor(n),
        nodeId: n.id,
        source: n.data.source,
        image: n.data.image,
        clusterId: n.data.clusterId,
        published: SOURCE_TYPES.has(String(n.type)),
      });
    }
    return out.sort((a, b) => a.year - b.year || a.sort.localeCompare(b.sort));
  }, [board.nodes, board.timeline]);
  const shown = rows.filter((r) => (withSources || !r.published) && (!only || r.clusterId === only));
  const hiddenSources = rows.filter((r) => r.published && (!only || r.clusterId === only)).length;

  let lastEra = '';
  return (
    <div className="h-full overflow-y-auto text-ink" style={{ background: 'var(--paper-noise), linear-gradient(#f4ecdb, #efe4cc)' }}>
      <div className="mx-auto max-w-[980px] px-6 py-10">
        <h2 className="text-center font-serif text-[34px] font-bold">The timeline</h2>
        <p className="text-center font-hand text-[21px] text-ink-soft">{shown.length ? `${shown.length} moments, from ${prettyDate(shown[0].date)} to ${prettyDate(shown.at(-1)!.date)}` : 'Dates from your digs will line up here.'}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
          {cases.length > 1 && (
            <>
              <button className={clsx('chip', !only && 'on')} onClick={() => setOnly(undefined)}>
                All cases
              </button>
              {cases.map((c) => (
                <button key={c.id} className={clsx('chip max-w-[240px]', only === c.id && 'on')} onClick={() => setOnly(c.id)} title={c.title}>
                  <span className="truncate">{c.title}</span>
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-ink/15" />
            </>
          )}
          {hiddenSources > 0 && (
            <button className={clsx('chip', withSources && 'on')} onClick={() => setWithSources((v) => !v)} title="Articles, posts, photos and videos dated by when they came out">
              {withSources ? 'Hide' : 'Show'} when sources came out ({hiddenSources})
            </button>
          )}
        </div>
        <div className="relative mt-10">
          <div className="absolute left-1/2 top-0 bottom-0 w-[3px] -translate-x-1/2 bg-[repeating-linear-gradient(#c8322f_0_10px,transparent_10px_16px)]" />
          {shown.map((r, i) => {
            const era = r.year < 0 ? `${Math.ceil(-r.year / 100)}00s BC` : r.year < 1000 ? `${Math.floor(r.year / 100)}00s` : `${Math.floor(r.year / 10)}0s`;
            const showEra = era !== lastEra;
            lastEra = era;
            const left = i % 2 === 0;
            return (
              <div key={r.key}>
                {showEra && (
                  <div className="relative z-10 my-6 flex justify-center">
                    <span className="date-scrap !text-[22px]">{era}</span>
                  </div>
                )}
                <div className={clsx('relative mb-5 flex', left ? 'justify-start pr-[52%]' : 'justify-end pl-[52%]')}>
                  <span className="absolute left-1/2 top-4 size-3.5 -translate-x-1/2 rounded-full ring-4 ring-[#f4ecdb]" style={{ background: r.color }} />
                  <button
                    onClick={() => r.nodeId && useUi.getState().focusNodes([r.nodeId])}
                    className="group w-full rounded-sm bg-[#fffdf7] p-3.5 text-left shadow-[0_8px_18px_-10px_rgba(0,0,0,.45)] transition hover:-translate-y-0.5 hover:rotate-[-0.5deg]"
                    style={{ borderTop: `4px solid ${r.color}`, opacity: r.published ? 0.85 : 1 }}
                  >
                    <div className="flex items-start gap-3">
                      {r.image && <img src={r.image} alt="" className="size-14 shrink-0 object-cover" />}
                      <div className="min-w-0">
                        <div className="font-hand text-[19px] leading-none text-[#b3261e]">{prettyDate(r.date)}</div>
                        <div className="mt-1 text-[14px] font-medium leading-snug">{r.title}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-soft">
                          {r.source && <Glyph id={r.source} />}
                          {r.published ? `${r.sub} · came out` : r.sub}
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
