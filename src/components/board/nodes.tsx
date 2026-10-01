import { Handle, NodeResizer, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import { ArrowDown, MessageCircle, Play, Square, BookOpen } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { sourceMeta } from '../../../shared/sources';
import { askAbout, autoFall, caseFromTangent, startDig, stopDig } from '../../lib/dig';
import { compact, domain, ENTITY_COLORS, ENTITY_LABEL, hash01, prettyDate } from '../../lib/utils';
import { useBoards } from '../../store/boards';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import type { ClueData, ClueNode } from '../../types';
import { Glyph, SourceBadge } from '../SourceBadge';
import { StaticMap } from './StaticMap';

type P = NodeProps<ClueNode>;

const WASHI = ['#8ea67c', '#c96d4b', '#dca83f', '#7fa7b5', '#c9a0c7'];

/** Cards drop in with a bounce the first time they appear, never again (zoom/scroll stay cheap). */
const seen = new Set<string>();
function useFresh(id: string) {
  const [fresh] = useState(() => !seen.has(id));
  seen.add(id);
  return fresh;
}

function Card(props: {
  id: string;
  data: ClueData;
  selected?: boolean;
  className: string;
  pin?: string;
  tape?: string | false;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const messy = useSettings((s) => s.messy);
  const rot = messy ? (props.data.rotation ?? 0) : 0;
  const fresh = useFresh(props.id);
  return (
    <div
      className={clsx('clue', fresh && 'fresh', props.className, props.selected && 'is-selected')}
      style={{ '--rot': `${rot}deg`, ...props.style } as CSSProperties}
    >
      {props.tape && <span className="tape washi" style={{ '--w': props.tape } as CSSProperties} />}
      <Handle type="source" position={Position.Top} id="pin" className="pin" style={{ '--pin': props.data.pin ?? props.pin ?? '#c8322f' } as CSSProperties} />
      {props.children}
    </div>
  );
}

const read = (id: string, url: string) => {
  const ui = useUi.getState();
  ui.select(id);
  ui.set({ readerUrl: url });
  ui.openTab('read');
};

function Actions({ id, data, dig = true, extra, inline }: { id: string; data: ClueData; dig?: boolean; extra?: ReactNode; inline?: boolean }) {
  return (
    <div className={clsx('clue-actions nodrag', inline && 'inline')}>
      {dig && (
        <button className="clue-btn" onClick={() => startDig({ query: data.query ?? data.title, parentId: id })}>
          <ArrowDown size={11} className="inline -mt-0.5 mr-0.5" />
          Dig
        </button>
      )}
      <button className="clue-btn" onClick={() => askAbout(id)}>
        <MessageCircle size={11} className="inline -mt-0.5 mr-0.5" />
        Ask
      </button>
      {data.url && (
        <button className="clue-btn" onClick={() => read(id, data.url!)}>
          <BookOpen size={11} className="inline -mt-0.5 mr-0.5" />
          Read
        </button>
      )}
      {extra}
    </div>
  );
}

// ─── Case file ────────────────────────────────────────────────────────────────
export function TopicNode({ id, data, selected }: P) {
  const digging = data.status === 'digging';
  return (
    <Card id={id} data={data} selected={selected} className="clue-topic" pin="#1f1f1f">
      <div className="absolute -top-[13px] left-[30px] z-10 font-type text-[11px] text-ink/70">
        CASE FILE Nº {String(data.caseNo ?? 0).padStart(3, '0')}
      </div>
      <div className="sheet relative">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-hand text-[19px] leading-none text-[#b3261e] mb-1.5">
              {(data.depth ?? 0) === 0 ? 'where it began' : `${data.depth} hole${data.depth === 1 ? '' : 's'} deep`}
            </div>
            <h2 className="clue-title text-[25px]">{data.title}</h2>
          </div>
          {data.image && (
            <div className="shrink-0 bg-white p-1 pb-3 shadow-md rotate-[4deg] w-[98px]">
              <img src={data.image} alt="" className="w-full aspect-square object-cover" draggable={false} />
            </div>
          )}
        </div>
        {data.premise && (
          <div className="premise-slip" role="note">
            <span className="stamp premise-stamp">Check this</span>
            <p>{data.premise}</p>
          </div>
        )}
        {data.hook && <p className="font-hand text-[21px] leading-[1.05] text-[#7a1d17] mt-2.5">{data.hook}</p>}
        {data.text ? (
          <p className="nowheel mt-2.5 text-[12.5px] leading-[1.55] text-ink/85 line-clamp-[10]">{data.text}</p>
        ) : (
          <p className="mt-3 font-type text-[13px] text-ink-soft shovel-dots">Pulling files</p>
        )}
        {(data.extras?.length ?? 0) > 0 && (
          <button
            className="more-finds nodrag"
            onClick={(e) => {
              e.stopPropagation();
              useUi.getState().select(id);
              useUi.getState().openTab('inspect');
            }}
          >
            + {data.extras!.length} more finds in this file
          </button>
        )}
        <div className="mt-3 flex items-end justify-between gap-2">
          <SourceBadge id={data.source} />
          <span className={clsx('stamp status-stamp text-[13px]', data.status === 'done' && 'done')}>
            {digging ? 'digging' : data.status === 'error' ? 'cold case' : 'open case'}
          </span>
        </div>
      </div>
      {data.statusText && (
        <div className="mt-2.5 font-mono text-[11px] text-ink/70 flex items-center gap-2">
          {digging && <span className="inline-block size-2 rounded-full bg-[#c8322f] animate-pulse" />}
          <span className="truncate">{data.statusText}</span>
        </div>
      )}
      <Actions
        id={id}
        data={data}
        dig={false}
        inline
        extra={
          digging ? (
            <button className="clue-btn" onClick={() => stopDig(id)}>
              <Square size={10} className="inline -mt-0.5 mr-1" />
              Stop
            </button>
          ) : (
            <button className="clue-btn !bg-plum/15 hover:!bg-plum/25" onClick={() => void autoFall(id, 3)} title="Automatically follow three rabbit holes in a row">
              🕳 Keep falling ×3
            </button>
          )
        }
      />
    </Card>
  );
}

// ─── Index card (people, places, events…) ─────────────────────────────────────
export function EntityNode({ id, data, selected }: P) {
  const type = data.entityType ?? 'concept';
  const color = data.color ?? ENTITY_COLORS[type];
  return (
    <Card id={id} data={data} selected={selected} className="clue-entity" pin={color}>
      <span
        className="tape washi !left-[62px] !w-[96px] !translate-x-0 grid place-items-center font-type text-[9.5px] tracking-[0.2em] uppercase text-white"
        style={{ '--w': color } as CSSProperties}
      >
        {ENTITY_LABEL[type]}
      </span>
      {data.image && (
        <div className="photo-clip">
          <img src={data.image} alt="" draggable={false} />
        </div>
      )}
      <h3 className={clsx('clue-title text-[19px] mt-1', data.image && 'pr-[74px]')}>{data.title}</h3>
      {data.text && <p className="mt-[13px] text-[12.5px] leading-[22px] text-ink/85 line-clamp-5">{data.text}</p>}
      {data.lat != null && data.lon != null && (
        <StaticMap points={[{ lat: data.lat, lon: data.lon, label: '' }]} width={216} height={84} labels={false} className="mini-map mt-2 rounded-sm" />
      )}
      {data.source && data.source !== 'wikipedia' && <SourceBadge id={data.source} className="mt-2" />}
      <Actions id={id} data={data} />
      {data.date && <div className="date-scrap absolute -bottom-3.5 right-3">{prettyDate(data.date)}</div>}
    </Card>
  );
}

// ─── Sticky note ──────────────────────────────────────────────────────────────
export function NoteNode({ id, data, selected }: P) {
  const [editing, setEditing] = useState(!data.text && !data.title);
  const update = useBoards((s) => s.updateNode);
  return (
    <Card id={id} data={data} selected={selected} className="clue-note" pin={data.pin ?? '#1f1f1f'} style={{ '--note': data.color ?? '#f7de6b' } as CSSProperties}>
      {editing ? (
        <textarea
          className="nodrag nowheel"
          autoFocus
          defaultValue={data.text ?? data.title}
          placeholder="scribble a thought…"
          onBlur={(e) => {
            update(id, { text: e.target.value, title: e.target.value.split('\n')[0].slice(0, 60) || 'Note' });
            setEditing(false);
          }}
          onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLTextAreaElement).blur()}
        />
      ) : (
        <div onDoubleClick={() => setEditing(true)} className="whitespace-pre-wrap min-h-[140px]">
          {data.text || data.title || <span className="opacity-50">double-click to write</span>}
        </div>
      )}
    </Card>
  );
}

// ─── Who's who: a contact sheet of portraits from the subject's wiki ─────────
export function GalleryNode({ id, data, selected }: P) {
  const people = data.items ?? [];
  return (
    <Card id={id} data={data} selected={selected} className="clue-gallery" pin={data.pin ?? '#c8322f'}>
      <div className="gallery-head">
        <span className="label-caps">Who's who</span>
        <h3 className="clue-title">{data.title}</h3>
      </div>
      <div className="gallery-grid">
        {people.slice(0, 10).map((p) => (
          <button
            key={p.title}
            className="gallery-face nodrag"
            title={`Read about ${p.title}`}
            onClick={(e) => {
              e.stopPropagation();
              if (p.url) read(id, p.url);
            }}
          >
            {p.image && <img src={p.image} alt="" draggable={false} loading="lazy" />}
            <span>{p.title}</span>
          </button>
        ))}
      </div>
      <SourceBadge id={data.source} className="mt-2 max-w-full" />
    </Card>
  );
}

// ─── Polaroid ─────────────────────────────────────────────────────────────────
export function ImageNode({ id, data, selected }: P) {
  const tape = WASHI[Math.floor(hash01(id) * WASHI.length)];
  return (
    <Card id={id} data={data} selected={selected} className="clue-image" tape={tape} pin={data.pin ?? '#1f1f1f'}>
      <div className="frame">
        {data.image && <img src={data.image} alt={data.title} draggable={false} loading="lazy" />}
        {data.date && <span className="film-date">{prettyDate(data.date)}</span>}
      </div>
      <div className="caption line-clamp-2">{data.title}</div>
      <SourceBadge id={data.source} className="mt-1.5 max-w-full" />
      <Actions id={id} data={data} dig={false} />
    </Card>
  );
}

// ─── Newspaper clipping / document ────────────────────────────────────────────
function torn(id: string) {
  const top: string[] = [];
  const bottom: string[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * 100;
    top.push(`${x}% ${(hash01(`${id}t${i}`) * 3.2).toFixed(1)}%`);
    bottom.push(`${100 - x}% ${(100 - hash01(`${id}b${i}`) * 3.2).toFixed(1)}%`);
  }
  return `polygon(${[...top, ...bottom].join(',')})`;
}

export function ClipNode({ id, data, selected }: P) {
  const clip = useMemo(() => torn(id), [id]);
  const meta = data.meta ?? {};
  const site = (meta.site as string) || domain(data.url);
  return (
    <Card id={id} data={data} selected={selected} className="clue-clip" style={{ clipPath: clip }}>
      <div className="flex items-center justify-between gap-2 border-b border-ink/25 pb-1.5 mb-2">
        <SourceBadge id={data.source} className="min-w-0" />
        {data.date && <span className="shrink-0 whitespace-nowrap font-type text-[10.5px] text-ink-soft">{prettyDate(data.date)}</span>}
      </div>
      {data.image && <img className="thumb" src={data.image} alt="" draggable={false} loading="lazy" />}
      <div className="headline">{data.title}</div>
      {(data.author || site) && <div className="mt-1 font-type text-[10.5px] text-ink-soft truncate">{data.author ?? site}</div>}
      {data.text && <p className="body mt-1.5 line-clamp-6">{data.text}</p>}
      {Object.keys(meta).length > 0 && (
        <div className="clear-both mt-2 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-ink-soft">
          {Object.entries(meta)
            .filter(([k]) => k !== 'site')
            .slice(0, 3)
            .map(([k, v]) => (
              <span key={k}>
                {k}: {typeof v === 'number' ? compact(v) : String(v).slice(0, 28)}
              </span>
            ))}
        </div>
      )}
      <Actions id={id} data={data} />
    </Card>
  );
}

// ─── Forum post (Reddit, HN, Lemmy, Stack Exchange) ───────────────────────────
export function PostNode({ id, data, selected }: P) {
  const src = sourceMeta(data.source ?? 'reddit');
  const m = data.meta ?? {};
  return (
    <Card id={id} data={data} selected={selected} className="clue-post" style={{ '--src': src.color } as CSSProperties} pin={src.color}>
      <div className="bar" />
      {data.image && <img src={data.image} alt="" className="h-[120px] w-full object-cover" draggable={false} loading="lazy" />}
      <div className="px-3.5 pt-2.5 pb-3">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-ink-soft">
          <Glyph id={src.id} />
          <span className="min-w-0 truncate font-semibold text-ink">{m.sub ?? src.name}</span>
          {data.date && <span className="shrink-0 whitespace-nowrap">· {prettyDate(data.date)}</span>}
        </div>
        <div className="mt-1.5 font-semibold text-[14px] leading-snug">{data.title}</div>
        {data.text && <p className="mt-1.5 text-[12px] leading-[1.45] text-ink/75 line-clamp-4">{data.text}</p>}
        <div className="mt-2 flex gap-3 font-mono text-[11px] text-ink-soft">
          <span>▲ {compact(m.score as number)}</span>
          <span>💬 {compact(m.comments as number)}</span>
          {data.author && <span className="truncate">{data.author}</span>}
        </div>
        <Actions id={id} data={data} />
      </div>
    </Card>
  );
}

// ─── Tape (video / audio) ─────────────────────────────────────────────────────
export function MediaNode({ id, data, selected }: P) {
  const [playing, setPlaying] = useState(false);
  const media = data.media;
  const embed =
    media?.type === 'youtube'
      ? `https://www.youtube-nocookie.com/embed/${media.src}?autoplay=1`
      : media?.type === 'archive'
        ? `https://archive.org/embed/${media.src}?autoplay=1`
        : null;
  return (
    <Card id={id} data={data} selected={selected} className="clue-video" pin="#1f1f1f">
      <div className="screen nodrag nowheel">
        {playing && embed ? (
          <iframe src={embed} className="absolute inset-0 w-full h-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen title={data.title} />
        ) : playing && media?.type === 'audio' ? (
          <div className="absolute inset-0 grid place-items-center bg-[#1b1714] p-3">
            {data.image && <img src={data.image} alt="" className="absolute inset-0 opacity-30 blur-sm" />}
            <audio src={media.src} controls autoPlay className="relative w-full" />
          </div>
        ) : (
          <>
            {data.image && <img src={data.image} alt="" draggable={false} loading="lazy" />}
            {(media || data.url) && (
              <button
                className="play"
                onClick={() => (media ? setPlaying(true) : window.open(data.url, '_blank', 'noopener'))}
                aria-label="Play"
              >
                <Play size={22} fill="#fff" color="#fff" className="ml-0.5" />
              </button>
            )}
            {data.meta?.length && (
              <span className="absolute right-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px]">{data.meta.length}</span>
            )}
          </>
        )}
      </div>
      <div className="label">
        <div className="line-clamp-2">{data.title}</div>
        <div className="mt-1 flex items-center gap-2 font-ui text-[10.5px] font-normal text-ink-soft">
          {data.source && <Glyph id={data.source} />}
          <span className="truncate">{[data.author, data.meta?.views && `${data.meta.views} views`, data.date].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      <div className="[&_.clue-btn]:bg-white/10 [&_.clue-btn]:text-[#f3e9da]">
        <Actions id={id} data={data} />
      </div>
    </Card>
  );
}

// ─── The rabbit hole ──────────────────────────────────────────────────────────
function Ears() {
  return (
    <svg width="56" height="40" viewBox="0 0 56 40" className="ears">
      <path d="M17 40 C 10 22, 8 6, 15 2 C 22 -1, 24 20, 24 40 Z" fill="#f4ede1" stroke="#2b221c" strokeWidth="1.5" />
      <path d="M17 36 C 13 24, 13 10, 16 7 C 19 6, 20 22, 21 36 Z" fill="#f2b8b0" />
      <path d="M33 40 C 33 20, 36 0, 43 3 C 50 7, 45 24, 40 40 Z" fill="#f4ede1" stroke="#2b221c" strokeWidth="1.5" />
      <path d="M36 36 C 36 22, 39 8, 42 8 C 45 10, 42 24, 39 36 Z" fill="#f2b8b0" />
    </svg>
  );
}

export function TangentNode({ id, data, selected }: P) {
  return (
    <Card id={id} data={data} selected={selected} className={clsx('clue-tangent', data.explored && 'explored')} pin="#7e5a9b">
      <div className="hole">
        {!data.explored && <Ears />}
        <div className="pit">
          <div className="swirl" />
        </div>
      </div>
      <div className="text-center">
        <div className="font-hand text-[16px] leading-none text-plum">rabbit hole</div>
        <div className="clue-title text-[17px] mt-1">{data.title}</div>
        {data.hook && <p className="font-hand text-[18px] leading-[1.05] text-ink/80 mt-1.5">{data.hook}</p>}
      </div>
      <div className="nodrag mt-3 flex justify-center gap-2">
        {data.explored ? (
          <button
            className="clue-btn"
            onClick={() => {
              const target = caseFromTangent(id);
              if (target) useUi.getState().focusNodes([target]);
            }}
            title="Fly to the case this rabbit hole opened"
          >
            explored · go there →
          </button>
        ) : (
          <button className="btn-stamp px-3.5 py-1.5 text-[13px]" onClick={() => startDig({ query: data.query ?? data.title, title: data.title, parentId: id })}>
            fall in ↓
          </button>
        )}
      </div>
    </Card>
  );
}

// ─── Open question ────────────────────────────────────────────────────────────
export function QuestionNode({ id, data, selected }: P) {
  return (
    <Card id={id} data={data} selected={selected} className="clue-question" pin="#c8322f">
      <span className="qmark">?</span>
      <div>{data.title}</div>
      <div className="clue-actions nodrag">
        <button className="clue-btn" onClick={() => askAbout(id)}>
          Investigate
        </button>
        <button className="clue-btn" onClick={() => startDig({ query: data.query ?? data.title, parentId: id })}>
          Dig
        </button>
      </div>
    </Card>
  );
}

// ─── Quote ────────────────────────────────────────────────────────────────────
export function QuoteNode({ id, data, selected }: P) {
  return (
    <Card id={id} data={data} selected={selected} className="clue-quote" tape={WASHI[2]}>
      <p className="line-clamp-6">{data.text || data.title}</p>
      <div className="mt-2 font-type text-[11px] not-italic text-ink-soft">— {data.author ?? data.title}</div>
      <Actions id={id} data={data} />
    </Card>
  );
}

// ─── Handwritten scrap ────────────────────────────────────────────────────────
export function LabelNode({ id, data, selected }: P) {
  const update = useBoards((s) => s.updateNode);
  return (
    <Card id={id} data={data} selected={selected} className="clue-label" tape={WASHI[Math.floor(hash01(id) * WASHI.length)]} style={{ color: data.color }}>
      <input
        className="nodrag"
        defaultValue={data.title}
        placeholder="HOW?!"
        size={Math.max(4, (data.title || 'HOW?!').length)}
        onBlur={(e) => update(id, { title: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </Card>
  );
}

// ─── Pinned map ───────────────────────────────────────────────────────────────
export function MapNode({ id, data, selected, width, height }: P) {
  const w = (width ?? 540) - 16;
  const h = (height ?? 400) - 16;
  const points = data.points ?? [];
  const updateInternals = useUpdateNodeInternals();
  const messy = useSettings((s) => s.messy);
  const fresh = useFresh(id);
  useEffect(() => updateInternals(id), [id, points.length, w, h, updateInternals]);
  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={300} minHeight={220} lineStyle={{ borderColor: 'transparent' }} handleStyle={{ width: 10, height: 10, borderRadius: 3 }} />
      <div
        className={clsx('clue clue-map', fresh && 'fresh', selected && 'is-selected')}
        style={{ '--rot': `${messy ? (data.rotation ?? 0) * 0.4 : 0}deg`, width: w + 16, height: h + 16 } as CSSProperties}
      >
        <Handle type="source" position={Position.Top} id="pin" className="pin" style={{ '--pin': '#1f1f1f' } as CSSProperties} />
        {[
          [4, 4],
          [w + 1, 4],
          [4, h + 1],
          [w + 1, h + 1],
        ].map(([l, t], i) => (
          <span key={i} className="corner-pin" style={{ left: l, top: t }} />
        ))}
        <StaticMap points={points} width={w} height={h} handles className="tiles" />
        <div className="crease" />
        <div className="absolute left-4 bottom-3 date-scrap !text-[17px] max-w-[70%] truncate">{data.title.replace(/^Map: /, '')}</div>
        <div className="absolute right-3 bottom-2.5 font-ui text-[8px] text-ink/50">Tiles © Esri, National Geographic</div>
      </div>
    </>
  );
}

export const nodeTypes = {
  topic: TopicNode,
  entity: EntityNode,
  note: NoteNode,
  image: ImageNode,
  clip: ClipNode,
  post: PostNode,
  video: MediaNode,
  tangent: TangentNode,
  question: QuestionNode,
  quote: QuoteNode,
  label: LabelNode,
  map: MapNode,
  gallery: GalleryNode,
};
