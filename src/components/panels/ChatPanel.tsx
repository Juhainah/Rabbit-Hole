import clsx from 'clsx';
import { ArrowDown, ChevronDown, Eraser, Pin, RotateCcw, SendHorizontal } from 'lucide-react';
import { nanoid } from 'nanoid';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';
import { boardContext } from '../../lib/context';
import { addClue, caseName, pinItem, startDig, topicOf } from '../../lib/dig';
import { currentBoard, useBoards } from '../../store/boards';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import type { EntityType, SourceItem } from '../../../shared/types';
import { nameMatcher, tokenize } from '../../lib/names';
import { MicButton } from './MicButton';
import { makeEdge } from '../../lib/factory';
import { play } from '../../lib/sound';
import type { ChatEntry } from '../../types';
import { Glyph } from '../SourceBadge';

/**
 * Splits the answer from its closing "TANGENTS: a | b | c" line. While the reply
 * is still streaming, a half-written tangents line is hidden instead of flickering.
 */
// "ACTION: pin 3", "- **ACTION:** pin 3" and "1. **ACTION**: pin 3" all count.
const ACTION_LINE = /^[ \t]*(?:[-*•+][ \t]+|\d+[.)][ \t]+)?\**[ \t]*ACTION[ \t]*\**[ \t]*:[ \t]*\**[ \t]*(.+?)[ \t]*$\n?/gim;

function splitAnswer(content: string, pending = false) {
  let text = content.replace(/<(think|thought)>[\s\S]*?(<\/(think|thought)>|$)/gi, '');
  // Board actions are instructions for the app, not for reading.
  const actions = [...text.matchAll(ACTION_LINE)].map((m) => m[1].replace(/\*\*/g, '').trim()).filter(Boolean);
  text = text.replace(ACTION_LINE, '').replace(/\n{3,}/g, '\n\n');
  if (pending) {
    // Hide a half-written TANGENTS or ACTION line instead of letting it flicker.
    const cut = text.search(/\n[ \t]*(?:[-*•+][ \t]+|\d+[.)][ \t]+)?\**[ \t]*(T(A(N(G(E(N(T(S)?)?)?)?)?)?)?|A(C(T(I(O(N)?)?)?)?)?)?[^\n]*$/i);
    return { text: cut >= 0 ? text.slice(0, cut).trimEnd() : text, tangents: [] as string[], actions: [] as string[] };
  }
  let tangents: string[] = [];
  const m = text.match(/\n?\s*\**TANGENTS?\**:?\**\s*(.+?)\s*$/i);
  if (m) {
    tangents = m[1]
      .split('|')
      .map((t) => t.replace(/^[\s*\-•]+|[\s*]+$/g, '').replace(/^\d+[).:]\s*/, '').trim())
      .filter((t) => t.length > 1 && t.length < 90)
      .slice(0, 4);
    text = text.slice(0, m.index).trimEnd();
  }
  return { text: text.trimEnd(), tangents, actions };
}

const STARTERS = [
  'What is the strangest detail on this board?',
  'Which clues contradict each other?',
  'What connects these cases that I might have missed?',
  'Give me the skeptic’s explanation.',
];

const NO_CHAT: ChatEntry[] = [];

/** The board card a title refers to: exact match first, then a close one. */
function findCard(title: string) {
  const t = title.trim().toLowerCase();
  if (t.length < 3) return undefined;
  const nodes = currentBoard().nodes.filter((n) => n.data.title);
  return (
    nodes.find((n) => n.data.title.toLowerCase() === t) ??
    nodes.find((n) => t.length >= 5 && (n.data.title.toLowerCase().includes(t) || t.includes(n.data.title.toLowerCase())) && n.data.title.length >= 4)
  );
}

function flyTo(id: string) {
  const ui = useUi.getState();
  ui.select(id);
  ui.focusNodes([id]);
}

/** A card mentioned in an answer: click to fly the board to it. */
function CardLink({ title, children }: { title: string; children?: React.ReactNode }) {
  const card = findCard(title);
  if (!card) return <strong>{children ?? title}</strong>;
  return (
    <button
      onClick={() => flyTo(card.id)}
      title="Show this card on the board"
      className="mx-0.5 inline-flex items-baseline gap-1 rounded bg-[#c8322f]/10 px-1.5 py-px font-semibold text-[#9f1f1b] underline decoration-[#c8322f]/40 decoration-dotted underline-offset-2 transition hover:bg-[#c8322f]/20"
    >
      <span className="text-[10px]">📌</span>
      {children ?? title}
    </button>
  );
}

/** [[Card title]] → a link the markdown renderer turns into a CardLink. */
const linkCards = (text: string) => text.replace(/\[\[([^\]\n]{2,120})\]\]/g, (_, t: string) => `[${t}](#card:${encodeURIComponent(t)})`);

const markdownParts = {
  a: ({ href, children, ...p }: React.ComponentProps<'a'>) =>
    href?.startsWith('#card:') ? (
      <CardLink title={decodeURIComponent(href.slice(6))}>{children}</CardLink>
    ) : (
      <a {...p} href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
  // Bold names that match a card become links too.
  strong: ({ children }: React.ComponentProps<'strong'>) => {
    const text = typeof children === 'string' ? children : Array.isArray(children) && children.every((c) => typeof c === 'string') ? children.join('') : null;
    return text && findCard(text) && text.length >= 4 ? <CardLink title={text}>{children}</CardLink> : <strong>{children}</strong>;
  },
};

/** The card new pins/digs from the chat should attach to. */
function anchorId() {
  const board = currentBoard();
  const sel = board.nodes.find((n) => n.id === useUi.getState().selectedNodeId);
  return sel?.id ?? topicOf(board, board.nodes.filter((n) => n.type === 'topic').at(-1))?.id;
}

/** The case a pinned source belongs to: the one it names, else the case being asked about. */
function homeFor(src: SourceItem, fallback?: string) {
  const board = currentBoard();
  const toks = tokenize(`${src.title} ${src.snippet ?? ''} ${src.url ?? ''}`);
  const named = board.nodes.filter((n) => n.type === 'topic').find((t) => nameMatcher(t.data.query ?? t.data.title)(toks));
  if (named) return named.id;
  const anchor = board.nodes.find((n) => n.id === fallback);
  return topicOf(board, anchor)?.id ?? fallback;
}

/** Carries out the partner's board actions. Returns a line per thing done. */
function runActions(actions: string[], sources: SourceItem[]): string[] {
  const done: string[] = [];
  const near = anchorId();
  // New cards first, so connect/add lines in the same answer can find them.
  const kinds = /^(person|place|event|org|organization|object|thing|concept)$/i;
  for (const a of actions) {
    const card = a.match(/^card\s+(\w+)\s+(.+?)(?:\s*:\s*(.+))?$/i);
    if (!card) continue;
    const title = card[2].replace(/^\[\[|\]\]$|^"|"$/g, '').trim().slice(0, 80);
    if (!title) continue;
    if (findCard(title)) {
      done.push(`Already on the board: “${title}”`);
      continue;
    }
    const kind = card[1].toLowerCase();
    const entityType = (kinds.test(kind) ? (kind === 'organization' ? 'org' : kind === 'thing' ? 'object' : kind) : 'concept') as EntityType;
    addClue('entity', { title, entityType, text: card[3]?.trim().slice(0, 400) }, { near });
    done.push(`Added a card for “${title}”`);
  }
  for (const a of actions.slice(0, 12)) {
    if (/^card\s/i.test(a)) continue;
    const fact = a.match(/^add\s+to\s+\[\[(.+?)\]\]\s*:\s*(.+)/i);
    if (fact) {
      const target = findCard(fact[1]);
      if (target) {
        const text = target.data.text?.trim();
        useBoards.getState().updateNode(target.id, { text: `${text ? `${text}\n\n` : ''}• ${fact[2].trim().slice(0, 500)}` });
        done.push(`Wrote on “${target.data.title}”`);
      }
      continue;
    }
    const pin = a.match(/^pin\s+([#\d,\s]+)/i);
    if (pin) {
      for (const n of pin[1].split(/[,\s#]+/).filter(Boolean).map(Number)) {
        const src = sources[n - 1];
        if (!src) continue;
        const already = !!src.url && currentBoard().nodes.some((n) => n.data.url === src.url);
        pinItem(src, { near: homeFor(src, near) });
        done.push(`${already ? 'Already on the board:' : 'Pinned'} “${src.title.slice(0, 60)}”`);
      }
      continue;
    }
    const tie = a.match(/^connect\s+\[\[(.+?)\]\]\s*(?:->|→|to|and)\s*\[\[(.+?)\]\](?:\s*:\s*(.+))?/i);
    if (tie) {
      const from = findCard(tie[1]);
      const to = findCard(tie[2]);
      if (from && to && from.id !== to.id) {
        useBoards.getState().addEdges([makeEdge(from.id, to.id, { kind: 'user', label: tie[3]?.trim().slice(0, 40) })]);
        done.push(`Tied “${from.data.title}” to “${to.data.title}”`);
      }
      continue;
    }
    const note = a.match(/^note\s+(.+)/i);
    if (note) {
      addClue('note', { text: note[1].slice(0, 400), title: note[1].slice(0, 60), color: '#fdf6e3' }, { near, tie: true });
      done.push('Left a sticky note');
    }
  }
  if (done.length) play('pin');
  return done;
}

const Message = memo(function Message({ m, onRetry }: { m: ChatEntry; onRetry?: () => void }) {
  const { text, tangents } = splitAnswer(m.content, m.pending);
  if (m.role === 'user') {
    return <div className="ml-10 rounded-lg rounded-tr-sm bg-ink px-3.5 py-2.5 text-[13.5px] leading-relaxed text-paper">{m.content}</div>;
  }
  const photos = (m.sources ?? []).filter((s) => s.image).slice(0, 6);
  return (
    <div>
      {m.sources?.length ? (
        <details className="group mb-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11.5px] font-medium text-ink-soft hover:text-ink">
            <ChevronDown size={13} className="-rotate-90 transition group-open:rotate-0" />
            Read {m.sources.length} source{m.sources.length === 1 ? '' : 's'}
            <span className="flex gap-0.5">
              {[...new Set(m.sources.map((s) => s.source))].slice(0, 6).map((id) => (
                <Glyph key={id} id={id} className="!h-[15px] !min-w-[16px] !text-[8px]" />
              ))}
            </span>
          </summary>
          <div className="mt-1.5 grid gap-1">
            {m.sources.map((s, i) => (
              <button
                key={s.id}
                onClick={() => pinItem(s, { near: anchorId() })}
                title="Pin to board"
                className="flex items-center gap-2 rounded-md bg-white/60 px-2 py-1 text-left text-[12px] hover:bg-white"
              >
                <span className="w-4 shrink-0 font-mono text-[11px] text-ink-soft">{i + 1}</span>
                <Glyph id={s.source} className="!h-[15px] !text-[8px]" />
                <span className="truncate">{s.title}</span>
                <Pin size={11} className="ml-auto shrink-0 opacity-40" />
              </button>
            ))}
          </div>
        </details>
      ) : null}
      {photos.length > 0 && (
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {photos.map((s) => (
            <button key={s.id} onClick={() => pinItem(s, { near: anchorId() })} title={`Pin photo: ${s.title}`} className="group relative shrink-0">
              <img src={s.image} alt={s.title} className="h-[74px] w-[74px] rounded object-cover shadow-sm transition group-hover:-translate-y-0.5" loading="lazy" />
              <Pin size={11} className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 opacity-0 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}
      <div className={clsx('relative rounded-lg rounded-tl-sm bg-[#fffdf7] px-4 py-3 shadow-[0_4px_12px_-6px_rgba(0,0,0,.3)]', m.error && 'text-[#b3261e]')}>
        {m.pending && !text ? (
          <div className="text-[13px] text-ink-soft shovel-dots">{m.status ?? 'Thinking'}</div>
        ) : (
          <div className="prose-rh">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownParts}>
              {linkCards(text)}
            </ReactMarkdown>
          </div>
        )}
        {m.done?.length ? (
          <div className="mt-2.5 grid gap-1 border-t border-dashed border-ink/15 pt-2">
            {m.done.map((d, i) => (
              <div key={i} className="text-[12px] font-medium text-[#2f6b3a]">
                ✓ {d}
              </div>
            ))}
          </div>
        ) : null}
        {m.error && onRetry && (
          <button onClick={onRetry} className="chip mt-2">
            <RotateCcw size={12} /> Try again
          </button>
        )}
        {!m.pending && text && !m.error && (
          <button
            onClick={() => addClue('note', { text: text.replace(/[#*_`>]/g, '').slice(0, 420), title: text.slice(0, 60), color: '#fdf6e3' }, { near: anchorId() })}
            className="absolute -right-2 -top-2 rounded-full bg-paper p-1.5 text-ink-soft shadow ring-1 ring-ink/10 transition hover:rotate-12 hover:text-[#b3261e]"
            title="Pin this answer to the board"
          >
            <Pin size={12} />
          </button>
        )}
      </div>
      {tangents.length > 0 && (
        <div className="mt-2 animate-rise">
          <div className="text-[11.5px] font-medium text-ink-soft">Keep falling…</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tangents.map((t) => (
              <button key={t} onClick={() => void startDig({ query: t, parentId: anchorId() })} className="chip !border-plum/30 !bg-plum/10 hover:!bg-plum/20">
                <ArrowDown size={12} /> {t}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export function ChatPanel() {
  const chat = useBoards((s) => s.boards[s.currentId]?.chat ?? NO_CHAT);
  const research = useSettings((s) => s.researchChat);
  const useBoard = useSettings((s) => s.chatUsesBoard);
  const setPrefs = useSettings((s) => s.set);
  const prefill = useUi((s) => s.chatPrefill);
  const selectedId = useUi((s) => s.selectedNodeId);
  const selectedTitle = useBoards((s) => (selectedId ? s.boards[s.currentId]?.nodes.find((n) => n.id === selectedId)?.data.title : undefined));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [stuck, setStuck] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  // Follow the answer only while you're at the bottom, and jump instantly:
  // smooth-scrolling on every streamed word is what made the text bounce.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  }, [chat, stuck]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const s = useBoards.getState();
    const history = [...currentBoard().chat.filter((c) => !c.error && !c.pending), { role: 'user' as const, content: q }].map((c) => ({
      role: c.role,
      content: c.role === 'assistant' ? splitAnswer(c.content).text : c.content,
    }));
    s.addChat({ id: nanoid(8), role: 'user', content: q });
    const id = nanoid(8);
    s.addChat({ id, role: 'assistant', content: '', pending: true, status: research ? 'Checking the archives' : 'Thinking' });
    setInput('');
    setBusy(true);
    setStuck(true);
    abort.current = new AbortController();
    const prefs = useSettings.getState();
    // Last answer's sources travel along, so "pin that picture" can point back at them.
    const carrySources = [...currentBoard().chat].reverse().find((c) => c.role === 'assistant' && c.sources?.length)?.sources?.slice(0, 10);
    try {
      await api.chat(
        {
          carrySources,
          hint: (() => {
            const b = currentBoard();
            const sel = b.nodes.find((n) => n.id === useUi.getState().selectedNodeId);
            const topic = b.nodes.filter((n) => n.type === 'topic').at(-1);
            if (!sel) return topic?.data.query ?? topic?.data.title;
            // A card is searched together with its case: "Buenos Aires" + "Liam Payne death".
            const card = sel.data.query ?? sel.data.title;
            const inCase = caseName(sel);
            return inCase && !card.toLowerCase().includes(inCase.toLowerCase()) && sel.type !== 'topic' ? `${card} ${inCase}` : card;
          })(),
          messages: history,
          context: prefs.chatUsesBoard ? boardContext() : undefined,
          research,
          sources: prefs.searchSources.filter((x) => ['wikipedia', 'web', 'reddit', 'archive', 'hackernews', 'openalex', 'googlenews', 'youtube'].includes(x)).slice(0, 5),
        },
        (ev) => {
          const u = useBoards.getState().updateChat;
          if (ev.type === 'status') u(id, { status: ev.message });
          else if (ev.type === 'sources') u(id, { sources: ev.items });
          else if (ev.type === 'delta') u(id, (c) => ({ content: c.content + ev.text }));
          else if (ev.type === 'error') u(id, (c) => ({ content: c.content || ev.message, error: !c.content }));
        },
        abort.current.signal,
      );
    } catch (e) {
      if (!abort.current?.signal.aborted) useBoards.getState().updateChat(id, { content: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      useBoards.getState().updateChat(id, { pending: false });
      setBusy(false);
      // Now that the answer is complete, do what it asked of the board.
      const entry = currentBoard().chat.find((c) => c.id === id);
      if (entry && !entry.error) {
        const done = runActions(splitAnswer(entry.content).actions, entry.sources ?? []);
        if (done.length) useBoards.getState().updateChat(id, { done });
      }
    }
  };

  useEffect(() => {
    if (prefill) void send(prefill.text);
  }, [prefill?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastUser = [...chat].reverse().find((c) => c.role === 'user')?.content;

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (atBottom !== stuck) setStuck(atBottom);
        }}
        className="relative flex-1 space-y-4 overflow-y-auto px-4 py-4 [overflow-anchor:none]"
      >
        {chat.length === 0 ? (
          <div className="pt-6 text-center">
            <div className="font-hand text-[30px] leading-none">Your research partner</div>
            <p className="mx-auto mt-2 max-w-[290px] text-[13px] leading-relaxed text-ink-soft">
              Ask about anything on the board. It checks the archives first, cites what it finds, and points you at the next rabbit hole.
            </p>
            <div className="mt-5 grid gap-2">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => void send(s)} className="rounded-lg bg-[#fffdf7] px-3 py-2 text-left text-[13px] shadow-sm transition hover:-translate-y-0.5">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat.map((m, i) => <Message key={m.id} m={m} onRetry={m.error && i === chat.length - 1 && lastUser ? () => void send(lastUser) : undefined} />)
        )}
      </div>
      {!stuck && (
        <div className="relative">
          <button
            onClick={() => setStuck(true)}
            className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink px-3 py-1 text-[12px] text-paper shadow-lg"
          >
            <ArrowDown size={13} /> Latest
          </button>
        </div>
      )}
      <div className="border-t border-ink/10 bg-paper-2/60 px-3 pt-2 pb-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-ink-soft">
          <button onClick={() => setPrefs({ researchChat: !research })} className={clsx('chip !py-0.5 !text-[11px]', research && 'on')} title="Search the archives before answering">
            🔎 Research first
          </button>
          <button
            onClick={() => setPrefs({ chatUsesBoard: !useBoard })}
            className={clsx('chip !py-0.5 !text-[11px] max-w-[190px]', useBoard && 'on')}
            title={useBoard ? 'The partner reads your board (or the selected card) with every question' : 'The partner answers without looking at your board'}
          >
            <span className="truncate">📋 {useBoard ? (selectedTitle ? `Card: ${selectedTitle}` : 'Uses whole board') : 'Ignoring board'}</span>
          </button>
          {chat.length > 0 && (
            <button onClick={() => useBoards.getState().clearChat()} className="ml-auto rounded p-1 hover:bg-ink/10" title="Clear conversation">
              <Eraser size={14} />
            </button>
          )}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder="Ask, or tell it what to add…  (Enter to send)"
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-lg border border-ink/15 bg-white px-3 py-2 text-[13.5px] text-ink outline-none focus:border-ink/40"
          />
          <MicButton value={input} onChange={setInput} />
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort()} className="btn-stamp px-3 py-2.5 text-[12px]">
              STOP
            </button>
          ) : (
            <button className="btn-stamp p-2.5" title="Send">
              <SendHorizontal size={17} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
