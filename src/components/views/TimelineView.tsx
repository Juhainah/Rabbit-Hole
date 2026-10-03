import clsx from 'clsx';
import { nanoid } from 'nanoid';
import { FileText, Plus } from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { nodeColor, TYPE_LABEL, yearOf } from '../../lib/utils';
import { useBoards, useCurrentBoard } from '../../store/boards';
import { useUi } from '../../store/ui';
import type { ClueNode, ClueType } from '../../types';
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
  /** The card that shows this moment happened. */
  proof?: ClueNode;
  source?: string;
  image?: string;
  clusterId?: string;
  /** When a source was published, as opposed to something that happened in the story. */
  published?: boolean;
}

// Cards whose date is when they were published, not when something happened.
const SOURCE_TYPES = new Set(['clip', 'post', 'video', 'image', 'quote']);
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

/** "2001-09-11" → "11 Sep 2001"; "2014-05" → "May 2014"; "-44" → "44 BC". */
function when(date: string) {
  const iso = date.match(/^(-?\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!iso) return date;
  const [, y, m, d] = iso;
  const year = Number(y) < 0 ? `${-Number(y)} BC` : String(Number(y));
  const month = m && Number(m) >= 1 && Number(m) <= 12 ? MONTHS[Number(m) - 1] : '';
  return [d ? String(Number(d)) : '', month, year].filter(Boolean).join(' ');
}

const flyTo = (id?: string) => id && useUi.getState().focusNodes([id]);

/** Names of cards on the board, written as links in a moment's line. */
function withLinks(text: string, cards: ClueNode[]): ReactNode {
  const names = cards
    .map((c) => c.data.title)
    .filter((t) => t && t.length >= 4)
    .sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(\\b(?:${esc.join('|')})\\b)`, 'i'));
  if (parts.length === 1) return text;
  return parts.map((p, i) => {
    const card = i % 2 ? cards.find((c) => c.data.title.toLowerCase() === p.toLowerCase()) : undefined;
    return card ? (
      <span
        key={i}
        role="link"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          flyTo(card.id);
        }}
        className="cursor-pointer font-semibold text-[#8f1d18] underline decoration-[#c8322f]/40 decoration-2 underline-offset-2 hover:decoration-[#c8322f]"
      >
        {p}
      </span>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    );
  });
}

/** The story in order: what happened, case by case. Publication dates of sources are a separate, optional layer. */
export function TimelineView() {
  const board = useCurrentBoard();
  const [only, setOnly] = useState<string>();
  const [withSources, setWithSources] = useState(false);
  const [adding, setAdding] = useState(false);
  const cases = useMemo(() => board.nodes.filter((n) => n.type === 'topic').map((n) => ({ id: n.data.clusterId!, title: n.data.title })), [board.nodes]);
  const entities = useMemo(() => board.nodes.filter((n) => n.type === 'entity'), [board.nodes]);
  const rows = useMemo(() => {
    const byId = new Map(board.nodes.map((n) => [n.id, n]));
    const topicByCluster = new Map(board.nodes.filter((n) => n.type === 'topic').map((n) => [n.data.clusterId, n]));
    const out: Row[] = [];
    for (const t of board.timeline) {
      const y = yearOf(t.date);
      if (y == null) continue;
      const topic = topicByCluster.get(t.clusterId);
      const proof = t.nodeId ? byId.get(t.nodeId) : undefined;
      out.push({ key: t.id, year: y, sort: t.date, date: t.date, title: t.event, sub: topic?.data.title, color: '#c8322f', nodeId: proof?.id ?? topic?.id, proof, clusterId: t.clusterId });
    }
    const told = board.timeline.map((t) => ({ y: yearOf(t.date), text: t.event.toLowerCase(), clusterId: t.clusterId }));
    for (const n of board.nodes) {
      const y = yearOf(n.data.date);
      if (y == null) continue;
      const title = n.data.title?.toLowerCase() ?? '';
      if (n.type === 'entity' && title.length >= 3 && told.some((t) => t.y === y && t.clusterId === n.data.clusterId && t.text.includes(title))) continue;
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
    // Negative years sort numerically; within a year, by the date string (months, days).
    return out.sort((a, b) => a.year - b.year || a.sort.replace(/^-/, '').localeCompare(b.sort.replace(/^-/, '')));
  }, [board.nodes, board.timeline]);
  const shown = rows.filter((r) => (withSources || !r.published) && (!only || r.clusterId === only));
  const hiddenSources = rows.filter((r) => r.published && (!only || r.clusterId === only)).length;
  const caseCards = (clusterId?: string) => entities.filter((e) => !clusterId || e.data.clusterId === clusterId);

  let lastEra = '';
  return (
    <div className="h-full overflow-y-auto text-ink" style={{ background: 'var(--paper-noise), linear-gradient(#f4ecdb, #efe4cc)' }}>
      <div className="mx-auto max-w-[980px] px-4 py-8 md:px-6 md:py-10">
        <h2 className="text-center font-serif text-[28px] font-bold md:text-[34px]">The timeline</h2>
        <p className="text-center font-hand text-[19px] text-ink-soft md:text-[21px]">
          {shown.length ? `${shown.length} moments, from ${when(shown[0].date)} to ${when(shown.at(-1)!.date)}` : 'Dates from your digs will line up here.'}
        </p>
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
          {(
            <button className={clsx('chip', adding && 'on')} onClick={() => setAdding((v) => !v)} title="Add something that happened">
              <Plus size={12} /> Add a moment
            </button>
          )}
        </div>
        {adding && <AddMoment cases={cases} defaultCase={only ?? cases.at(-1)?.id} onDone={() => setAdding(false)} />}
        <div className="relative mt-8 md:mt-10">
          <div className="absolute bottom-0 left-[9px] top-0 w-[3px] bg-[repeating-linear-gradient(#c8322f_0_10px,transparent_10px_16px)] md:left-1/2 md:-translate-x-1/2" />
          {shown.map((r, i) => {
            const era = r.year < 0 ? `${Math.ceil(-r.year / 100)}00s BC` : r.year < 1000 ? `${Math.floor(r.year / 100)}00s` : `${Math.floor(r.year / 10)}0s`;
            const showEra = era !== lastEra;
            lastEra = era;
            const gap = i > 0 ? r.year - shown[i - 1].year : 0;
            const left = i % 2 === 0;
            return (
              <div key={r.key}>
                {showEra ? (
                  <div className="relative z-10 my-6 flex md:justify-center">
                    <span className="date-scrap !text-[20px] md:!text-[22px]">{era}</span>
                    {gap >= 2 && <span className="ml-2 self-center font-hand text-[17px] text-ink-soft">{gap} years later</span>}
                  </div>
                ) : (
                  gap >= 2 && <div className="relative z-10 -mt-1 mb-3 pl-8 font-hand text-[17px] text-ink-soft md:pl-0 md:text-center">· {gap} years later ·</div>
                )}
                <div className={clsx('relative mb-4 flex pl-8 md:mb-5 md:pl-0', left ? 'md:justify-start md:pr-[52%]' : 'md:justify-end md:pl-[52%]')}>
                  <span className="absolute left-[10px] top-4 size-3.5 -translate-x-1/2 rounded-full ring-4 ring-[#f4ecdb] md:left-1/2" style={{ background: r.color }} />
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => flyTo(r.nodeId)}
                    onKeyDown={(e) => e.key === 'Enter' && flyTo(r.nodeId)}
                    className="group w-full cursor-pointer rounded-sm bg-[#fffdf7] p-3.5 text-left shadow-[0_8px_18px_-10px_rgba(0,0,0,.45)] transition hover:-translate-y-0.5 hover:rotate-[-0.5deg]"
                    style={{ borderTop: `4px solid ${r.color}`, opacity: r.published ? 0.85 : 1 }}
                  >
                    <div className="flex items-start gap-3">
                      {r.image && <img src={r.image} alt="" className="size-14 shrink-0 object-cover" />}
                      <div className="min-w-0 flex-1">
                        <div className="font-hand text-[19px] leading-none text-[#b3261e]">{when(r.date)}</div>
                        <div className="mt-1 text-[14px] font-medium leading-snug">{r.published ? r.title : withLinks(r.title, caseCards(r.clusterId))}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-soft">
                          {r.source && <Glyph id={r.source} />}
                          <span className="min-w-0 truncate">{r.published ? `${r.sub} · came out` : r.sub}</span>
                          {r.proof && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                flyTo(r.proof!.id);
                                const url = r.proof!.data.url;
                                if (url) {
                                  useUi.getState().set({ readerUrl: url });
                                  useUi.getState().openTab('read');
                                }
                              }}
                              className="ml-auto inline-flex max-w-full items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5 font-medium text-ink/75 hover:bg-ink/10 hover:text-ink"
                              title={`Source: ${r.proof.data.title}`}
                            >
                              {r.proof.data.source ? <Glyph id={r.proof.data.source} className="!h-[13px] !text-[7px]" /> : <FileText size={11} />}
                              <span className="max-w-[180px] truncate">{r.proof.data.title}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Your own moment on the timeline: a date and what happened, filed under a case. */
function AddMoment({ cases, defaultCase, onDone }: { cases: { id: string; title: string }[]; defaultCase?: string; onDone: () => void }) {
  const [date, setDate] = useState('');
  const [event, setEvent] = useState('');
  // A board built by hand has no case files: its moments belong to the board itself.
  const [clusterId, setClusterId] = useState(defaultCase ?? cases[0]?.id ?? '');
  const valid = yearOf(date) != null && event.trim().length > 2;
  const save = () => {
    if (!valid) return;
    useBoards.getState().addTimeline([{ id: nanoid(6), date: date.trim(), event: event.trim().slice(0, 200), clusterId }]);
    setDate('');
    setEvent('');
    onDone();
  };
  return (
    <form
      className="mx-auto mt-4 grid max-w-[620px] gap-2 rounded-sm bg-[#fffdf7] p-3.5 shadow-[0_8px_18px_-10px_rgba(0,0,0,.45)] sm:grid-cols-[130px_1fr]"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input
        autoFocus
        value={date}
        onChange={(e) => setDate(e.target.value)}
        placeholder="2014-05-21"
        className="rounded border border-ink/15 bg-white px-2.5 py-1.5 text-[14px] outline-none focus:border-[#c8322f]"
        aria-label="When (year, year-month or full date)"
      />
      <input
        value={event}
        onChange={(e) => setEvent(e.target.value)}
        placeholder="What happened"
        className="rounded border border-ink/15 bg-white px-2.5 py-1.5 text-[14px] outline-none focus:border-[#c8322f]"
        aria-label="What happened"
      />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        {cases.length > 1 && (
          <select value={clusterId} onChange={(e) => setClusterId(e.target.value)} className="min-w-0 max-w-[60%] rounded border border-ink/15 bg-white px-2 py-1 text-[13px]" aria-label="Case">
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
        <span className="text-[11.5px] text-ink-soft">A year, a month (2014-05) or a full date.</span>
        <button type="submit" disabled={!valid} className="chip on ml-auto disabled:opacity-40">
          Add to the timeline
        </button>
      </div>
    </form>
  );
}
