import { ArrowDown, ExternalLink, MessageCircle, Pin } from 'lucide-react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ScrapeResult } from '../../../shared/types';
import { api } from '../../lib/api';
import { readerCache } from '../../lib/context';
import { addClue, pinUrl, startDig } from '../../lib/dig';
import { domain, prettyDate } from '../../lib/utils';
import { currentBoard, useBoards } from '../../store/boards';
import { useUi } from '../../store/ui';

const ytId = (url: string) => url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/)?.[1];

function YouTubeReader({ url, id }: { url: string; id: string }) {
  const [t, setT] = useState<{ title: string; text: string } | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const selected = useUi((s) => s.selectedNodeId);
  const load = () => {
    setLoading(true);
    api
      .transcript(id)
      .then((r) => {
        setT(r);
        readerCache.set(url, r);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  return (
    <div className="px-4 py-4">
      <div className="aspect-video overflow-hidden rounded bg-black shadow">
        <iframe src={`https://www.youtube-nocookie.com/embed/${id}`} className="h-full w-full" allowFullScreen title="video" />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button className="btn-stamp px-3 py-1.5 text-[12px]" onClick={() => void startDig({ query: '', url, parentId: selected })}>
          DIG THIS VIDEO ↓
        </button>
        {!t && (
          <button className="chip" onClick={load} disabled={loading}>
            {loading ? 'Fetching captions…' : 'Read transcript'}
          </button>
        )}
      </div>
      {err && <div className="mt-2 text-[12.5px] text-[#b3261e]">{err}</div>}
      {t && (
        <>
          <button
            className="chip mt-2"
            onClick={() => {
              useUi.getState().set({ chatPrefill: { text: 'Summarise this video transcript and pull out every claim worth checking.', at: Date.now() } });
              useUi.getState().openTab('ai');
            }}
          >
            <MessageCircle size={13} /> Ask partner about it
          </button>
          <div className="mt-3 whitespace-pre-wrap rounded bg-[#fffdf7] p-3 text-[12.5px] leading-relaxed text-ink/85">{t.text.slice(0, 20000)}</div>
        </>
      )}
    </div>
  );
}

export function ReaderPanel() {
  const url = useUi((s) => s.readerUrl);
  const selected = useUi((s) => s.selectedNodeId);
  const [page, setPage] = useState<ScrapeResult | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setShowAll(false);
    if (!url || ytId(url)) return;
    const cached = readerCache.get(url);
    if (cached && 'finalUrl' in cached) {
      setPage(cached);
      return;
    }
    setPage(null);
    setErr('');
    setLoading(true);
    api
      .scrape(url)
      .then((p) => {
        readerCache.set(url, p);
        setPage(p);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [url]);

  if (!url) {
    return (
      <div className="px-6 pt-10 text-center">
        <div className="font-hand text-[26px] leading-none">The reading room</div>
        <p className="mx-auto mt-2 max-w-[280px] text-[13px] leading-relaxed text-ink-soft">
          Hit “Read” on any clue to open its source here, cleaned up and readable. Dead links get pulled from the Wayback Machine. Links inside lead further down.
        </p>
      </div>
    );
  }
  const yt = ytId(url);
  if (yt) return <YouTubeReader url={url} id={yt} />;
  if (loading) return <div className="px-4 py-8 text-center text-[13px] text-ink-soft shovel-dots">Unfolding the document</div>;
  if (err || !page) return <div className="px-4 py-8 text-center text-[13px] text-[#b3261e]">{err || 'Nothing here.'}</div>;

  // Cards pointing at this page, so a locked one can be unpinned from here.
  const pinned = currentBoard().nodes.filter((n) => n.data.url === url);

  if (page.blocked) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-lg border border-dashed border-ink/25 bg-[#fffdf7] p-4">
          <div className="text-[26px]">🔒</div>
          <div className="mt-1 font-serif text-[19px] font-bold text-ink">{page.title}</div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink/80">{page.note}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {page.alternatives?.map((a) => (
              <a key={a.url} className="chip" href={a.url} target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> {a.label}
              </a>
            ))}
            <button className="chip" onClick={() => { useUi.getState().set({ searchPrefill: { q: page.title, at: Date.now() } }); useUi.getState().openTab('search'); }}>
              Find it elsewhere
            </button>
            {pinned.length > 0 && (
              <button className="chip !text-[#b3261e]" onClick={() => useBoards.getState().removeNodes(pinned.map((n) => n.id), 'Unpinned a locked source')}>
                Unpin this card
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const paras = page.text.split(/\n{2,}/).filter((p) => p.trim().length > 1);
  return (
    <div className="px-4 py-4">
      {page.via === 'wayback' && (
        <div className="mb-2 inline-block rotate-[-1deg] bg-[#fff3cd] px-2 py-1 font-type text-[11px] text-[#7a5a00] shadow-sm">
          recovered from the Wayback Machine{page.archivedAt ? `, ${page.archivedAt.slice(0, 4)}` : ''}
        </div>
      )}
      <div className="label-caps text-ink-soft">{page.siteName || domain(page.finalUrl)}</div>
      <h2 className="mt-1 font-serif text-[23px] font-bold leading-tight text-ink">{page.title}</h2>
      <div className="mt-1 text-[12px] text-ink-soft">{[page.byline, page.published && prettyDate(page.published)].filter(Boolean).join(' · ')}</div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button className="btn-stamp px-3 py-1.5 text-[12px]" onClick={() => void startDig({ query: '', url, parentId: selected })}>
          <ArrowDown size={12} className="inline -mt-0.5" /> DIG THIS PAGE
        </button>
        <button className="chip" onClick={() => addClue('clip', { title: page.title, text: page.excerpt || page.text.slice(0, 400), image: page.image, url, author: page.byline }, { near: selected, tie: true })}>
          <Pin size={13} /> Pin clipping
        </button>
        <button
          className="chip"
          onClick={() => {
            useUi.getState().set({ chatPrefill: { text: 'Summarise what I am reading and flag anything strange, disputed or worth chasing.', at: Date.now() } });
            useUi.getState().openTab('ai');
          }}
        >
          <MessageCircle size={13} /> Ask partner
        </button>
        <a className="chip" href={page.finalUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={13} />
        </a>
      </div>
      {page.note && <div className="mt-3 rounded-md bg-[#fff3cd]/70 px-3 py-2 text-[12.5px] leading-snug text-[#6b5000]">{page.note}</div>}
      {page.media?.type === 'archive' && (
        <div className="mt-3 overflow-hidden rounded bg-black shadow">
          <iframe src={`https://archive.org/embed/${page.media.src}`} className="aspect-video w-full" allowFullScreen title={page.title} />
        </div>
      )}
      {page.image && !page.media && <img src={page.image} alt="" className="mt-3 max-h-[320px] w-full rounded object-cover shadow" />}
      {page.format === 'markdown' ? (
        <article className="prose-rh mt-3 !text-[14px] [&_img]:max-w-full [&_img]:rounded">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>
            {page.text.slice(0, showAll ? 120000 : 12000)}
          </ReactMarkdown>
        </article>
      ) : (
        <article className="mt-3 space-y-3 font-serif text-[14.5px] leading-[1.65] text-ink/90">
          {paras.slice(0, showAll ? 2000 : 60).map((p, i) => (
            <p key={i} className="whitespace-pre-line">{p}</p>
          ))}
        </article>
      )}
      {(page.format === 'markdown' ? page.text.length > 12000 : paras.length > 60) && !showAll && (
        <button className="chip mt-3" onClick={() => setShowAll(true)}>
          Keep reading ({Math.round(page.text.length / 1000)}k characters)
        </button>
      )}
      {page.comments?.length ? (
        <>
          <div className="mt-6 label-caps text-ink-soft">Discussion · {page.comments.length} comments</div>
          <div className="mt-2 grid gap-2">
            {page.comments.map((c, i) => (
              <div key={i} className="rounded-md bg-[#fffdf7] px-3 py-2 text-[13px] leading-relaxed shadow-sm" style={{ marginLeft: Math.min(c.depth ?? 0, 3) * 14 }}>
                <div className="mb-0.5 flex gap-2 text-[11px] text-ink-soft">
                  {c.author && <span className="font-semibold">{c.author}</span>}
                  {c.score != null && <span>▲ {c.score}</span>}
                </div>
                <div className="whitespace-pre-line text-ink/90">{c.text.slice(0, 1500)}</div>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {page.alternatives?.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {page.alternatives.map((a) => (
            <a key={a.url} className="chip" href={a.url} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> {a.label}
            </a>
          ))}
        </div>
      ) : null}
      {page.images.length > 1 && (
        <>
          <div className="mt-5 label-caps text-ink-soft">Photos on this page · click to pin</div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {page.images.slice(0, 9).map((src) => (
              <button key={src} onClick={() => addClue('image', { title: page.title, image: src, url }, { near: selected, tie: true })} className="aspect-square overflow-hidden rounded bg-paper-3 transition hover:scale-105">
                <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
      {page.links.length > 0 && (
        <>
          <div className="mt-5 label-caps text-ink-soft">Leads on this page</div>
          <div className="mt-1.5 grid gap-0.5">
            {page.links.slice(0, 30).map((l) => (
              <div key={l.href} className="group flex items-center gap-2 rounded px-1.5 py-1 text-[12.5px] hover:bg-paper-2">
                <button onClick={() => useUi.getState().set({ readerUrl: l.href })} className="min-w-0 flex-1 truncate text-left text-teal hover:underline">
                  {l.text}
                </button>
                <button onClick={() => pinUrl(l.href, { near: selected })} className="shrink-0 rounded p-0.5 opacity-0 hover:bg-ink/10 group-hover:opacity-100" title="Pin link">
                  <Pin size={12} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
