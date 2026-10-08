import clsx from 'clsx';
import { ArrowDown, ChevronDown, Eraser, Pin, RotateCcw, SendHorizontal } from 'lucide-react';
import { nanoid } from 'nanoid';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';
import { boardContext } from '../../lib/context';
import { addClue, caseName, pinItem, shortLabel, startDig, topicOf } from '../../lib/dig';
import { currentBoard, onBoard, useBoards } from '../../store/boards';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import type { EntityType, SourceItem } from '../../../shared/types';
import { nameMatcher, tokenize } from '../../lib/names';
import { MicButton } from './MicButton';
import { centerOf, makeEdge, sizeOf } from '../../lib/factory';
import { fillGallery } from '../../lib/gallery';
import { freeSpot, untangle } from '../../lib/layout';
import { pinPlace } from '../../lib/places';
import { FRAME_COLORS } from '../../lib/utils';
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
/** "Pinned “X” and tied it to “Y”": each quoted card is a link that shows it on the board. */
function DoneLine({ text }: { text: string }) {
  const parts = text.split(/“([^”]+)”/);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <CardLink key={i} title={p} /> : <span key={i}>{p}</span>))}
    </>
  );
}

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

/**
 * A new person/place card gets its picture from Wikipedia, but only when that page is about
 * someone in this case (its summary mentions the case), never a namesake.
 */
async function pictureFor(nodeId: string, title: string, near?: string) {
  const board = currentBoard();
  const topic = topicOf(board, board.nodes.find((n) => n.id === near));
  const caseWords = tokenize(`${topic?.data.query ?? ''} ${topic?.data.title ?? ''}`).filter((w) => w.length >= 4 || /\d/.test(w));
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`);
    if (!r.ok) return;
    const p = await r.json();
    if (p.type === 'disambiguation') return;
    const about = tokenize(`${p.description ?? ''} ${p.extract ?? ''}`);
    // A one-word name ("Angela") could be anyone: then the page must mention the case.
    if (!/\s/.test(title.trim()) && caseWords.length && !caseWords.some((w) => about.includes(w))) return;
    const image = p.originalimage?.source && (p.originalimage.width ?? 0) <= 1600 ? p.originalimage.source : p.thumbnail?.source;
    const node = currentBoard().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const kind = kindFrom(String(p.description ?? ''));
    useBoards.getState().updateNode(nodeId, {
      ...(node.data.image ? {} : { image }),
      url: node.data.url ?? p.content_urls?.desktop?.page,
      ...(kind && node.data.entityType === 'concept' ? { entityType: kind } : {}),
      ...(!node.data.text && p.description ? { text: String(p.description).slice(0, 200) } : {}),
    });
  } catch {
    /* no picture is fine */
  }
}

/** "Indian writer" → person, "2014 film" → work: what kind of card a Wikipedia description makes. */
function kindFrom(description: string): EntityType | undefined {
  const d = description.toLowerCase();
  if (/\b(actor|actress|writer|author|poet|director|singer|musician|politician|player|journalist|businessman|businesswoman|scientist|activist|filmmaker|producer|novelist|artist|rapper|hijacker|terrorist|youtuber|personality|born \d)/.test(d)) return 'person';
  if (/\b(film|novel|short story|story|book|album|song|single|series|video game|game|play|poem|painting|documentary|magazine|newspaper|website|app)\b/.test(d)) return 'work';
  if (/\b(city|town|village|district|country|state|province|region|river|mountain|island|building|airport|neighbourhood|neighborhood)\b/.test(d)) return 'place';
  if (/\b(company|corporation|organi[sz]ation|band|group|party|agency|studio|publisher|network|university|team|airline)\b/.test(d)) return 'org';
  if (/\b(attack|war|battle|incident|disaster|crash|scandal|festival|election|protest|massacre)\b/.test(d)) return 'event';
  return undefined;
}

/** Carries out the partner's board actions. Returns a line per thing done. */
/** Words that ask for the board to change. A plain question never pins, adds or moves anything. */
const WANTS_CHANGE = /\b(add|adds|pin|bring|put|show me|find|get|fetch|attach|create|make|draw|connect|link|tie|frame|map it|on the map|timeline|quote card|question card|list|cast|fill|photos?|pictures?|images?|cards?|remove|delete|clean|tidy|rename|move|notes?|write|label|stamp|search|look up|locate|pull|place|organi[sz]e|arrange)\b/i;
// Actions that only search, allowed with any question.
const READ_ONLY = /^search\s/i;

function runActions(actions: string[], sources: SourceItem[]): string[] {
  const done: string[] = [];
  const near = anchorId();
  /** You picked a card before asking: new finds belong with it. */
  const picked = !!useUi.getState().selectedNodeId;
  /** Cards this answer put on the board (or found already there), shown when it is done. */
  const made: string[] = [];
  // New cards first, so connect/add lines in the same answer can find them.
  const kinds = /^(person|place|event|org|organization|object|thing|concept)$/i;
  const created: string[] = [];
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
    // "card question …", "card quote …", "card note …", "card label …": that kind of card, not an index card.
    const PLAIN: Record<string, 'question' | 'quote' | 'note' | 'label'> = { question: 'question', quote: 'quote', note: 'note', label: 'label', sticky: 'note' };
    const plain = PLAIN[kind];
    if (plain) {
      const line = card[3]?.trim().slice(0, 400);
      const id =
        plain === 'question'
          ? addClue('question', { title: title.replace(/\?*$/, '?') }, { near, tie: true })
          : plain === 'quote'
            ? addClue('quote', { title: line || 'Quote', text: `“${title.replace(/^["“]|["”]$/g, '')}”`, author: line || undefined }, { near, tie: true })
            : plain === 'label'
              ? addClue('label', { title: title.slice(0, 40) }, { near })
              : addClue('note', { title: title.slice(0, 60), text: [title, line].filter(Boolean).join('\n'), color: '#fdf6e3' }, { near, tie: true });
      created.push(id);
      done.push(`Added a ${plain === 'note' ? 'sticky note' : `${plain} card`}: “${title.slice(0, 60)}”`);
      continue;
    }
    const entityType = (kinds.test(kind) ? (kind === 'organization' ? 'org' : kind === 'thing' ? 'object' : kind) : 'concept') as EntityType;
    const id = addClue('entity', { title, entityType, text: card[3]?.trim().slice(0, 400) }, { near });
    created.push(id);
    if (['person', 'place', 'org', 'object', 'event'].includes(entityType)) void pictureFor(id, title, near);
    done.push(`Added a card for “${title}”`);
  }
  const wrote = new Map<string, number>();
  const removals = new Set<string>();
  const removedTitles: string[] = [];
  for (const a of actions.slice(0, 40)) {
    if (/^card\s/i.test(a)) continue;
    const fact = a.match(/^add\s+to\s+\[\[(.+?)\]\]\s*:\s*(.+)/i);
    if (fact) {
      const target = findCard(fact[1]);
      // Two facts per card per answer at most: a card is a clue, not a wall of text.
      if (target && (wrote.get(target.id) ?? 0) < 2) {
        wrote.set(target.id, (wrote.get(target.id) ?? 0) + 1);
        const text = target.data.text?.trim();
        useBoards.getState().updateNode(target.id, { text: `${text ? `${text}\n\n` : ''}• ${fact[2].trim().slice(0, 500)}` });
        done.push(`Wrote on “${target.data.title}”`);
      }
      continue;
    }
    // "pin 3 -> [[Card]] : what it shows" ties the new card to the one it is evidence for.
    const pin = a.match(/^pin\s+([#\d,\s]+?)\s*(?:(?:->|→|to|on|onto)\s*\[\[(.+?)\]\](?:\s*:\s*(.+))?)?$/i);
    if (pin) {
      const named = pin[2] ? findCard(pin[2]) : undefined;
      for (const n of pin[1].split(/[,\s#]+/).filter(Boolean).map(Number)) {
        const src = sources[n - 1];
        if (!src) continue;
        const existing = src.url ? currentBoard().nodes.find((x) => x.data.url === src.url) : undefined;
        // Tied to the card the answer names, else the card you are asking about, else the case it belongs to.
        const to = named?.id ?? (picked ? near : homeFor(src, near));
        const toTitle = currentBoard().nodes.find((x) => x.id === to)?.data.title;
        if (existing) {
          if (to && to !== existing.id && !currentBoard().edges.some((e) => (e.source === to && e.target === existing.id) || (e.source === existing.id && e.target === to))) {
            useBoards.getState().addEdges([makeEdge(to, existing.id, { kind: 'evidence', label: shortLabel(pin[3]) })]);
            done.push(`Already on the board: “${src.title.slice(0, 50)}”; tied it to “${toTitle}”`);
          } else done.push(`Already on the board: “${src.title.slice(0, 60)}”`);
          made.push(existing.id);
          continue;
        }
        made.push(pinItem(src, { near: to, label: pin[3] }));
        done.push(`Pinned “${src.title.slice(0, 60)}”${toTitle ? ` and tied it to “${toTitle}”` : ''}`);
      }
      continue;
    }
    const tie = a.match(/^connect\s+\[\[(.+?)\]\]\s*(?:->|→|to|and)\s*\[\[(.+?)\]\](?:\s*:\s*(.+))?/i);
    if (tie) {
      const make = (title: string) => {
        const clean = title.replace(/^["“]|["”]$/g, '').trim().slice(0, 80);
        if (!clean) return undefined;
        const id = addClue('entity', { title: clean, entityType: 'concept' }, { near });
        void pictureFor(id, clean, near);
        done.push(`Added a card for “${clean}”`);
        return currentBoard().nodes.find((n) => n.id === id);
      };
      let from = findCard(tie[1]);
      let to = findCard(tie[2]);
      // Only when one end is already on the board: never invent a whole pair.
      if (from && !to) to = make(tie[2]);
      else if (to && !from) from = make(tie[1]);
      if (from && to && from.id !== to.id) {
        useBoards.getState().addEdges([makeEdge(from.id, to.id, { kind: 'user', label: shortLabel(tie[3]) })]);
        done.push(`Tied “${from.data.title}” to “${to.data.title}”`);
      }
      continue;
    }
    const gone = a.match(/^remove\s+\[\[(.+?)\]\]/i);
    if (gone) {
      const card = findCard(gone[1]);
      if (!card || removals.has(card.id)) continue;
      // A case file goes with everything dug up in that case.
      const ids = card.type === 'topic' ? currentBoard().nodes.filter((n) => n.data.clusterId === card.data.clusterId).map((n) => n.id) : [card.id];
      ids.forEach((id) => removals.add(id));
      removedTitles.push(card.type === 'topic' ? `the case “${card.data.title}” (${ids.length} cards)` : `“${card.data.title}”`);
      continue;
    }
    const renamed = a.match(/^rename\s+\[\[(.+?)\]\]\s*(?::|->|→|to)\s*(.+)/i);
    if (renamed) {
      const card = findCard(renamed[1]);
      if (card) {
        useBoards.getState().snapshot(`Renamed “${card.data.title}”`);
        useBoards.getState().updateNode(card.id, { title: renamed[2].replace(/^["“]|["”]$/g, '').trim().slice(0, 90) });
        done.push(`Renamed “${card.data.title}”`);
      }
      continue;
    }
    // "list Celestial Spirit keys from Fairy Tail": a pictured list card from that fan wiki.
    const listOf = a.match(/^list\s+(.+?)\s+(?:from|in|of)\s+(.+?)$/i);
    if (listOf) {
      const what = listOf[1].replace(/^["“]|["”]$/g, '').trim();
      const subject = listOf[2].replace(/^\[\[|\]\]$|^["“]|["”]$/g, '').trim();
      const anchor = findCard(subject)?.id ?? near;
      void api
        .findList(subject, what)
        .then((g) => {
          const id = addClue('gallery', { title: `${subject}: ${g.title}`, listLabel: g.label, url: g.url, source: g.source ?? 'fandom', items: g.items }, { near: anchor, tie: true });
          useUi.getState().log(`🗂 ${g.label}: ${g.items.length} from ${g.source === 'fandom' || !g.source ? `the ${g.wiki} wiki` : g.wiki}`, 'ok');
          setTimeout(() => useUi.getState().focusNodes([id]), 300);
        })
        .catch((e) => useUi.getState().log(`Couldn't find a list of ${what} for ${subject}: ${e instanceof Error ? e.message : e}`, 'warn'));
      done.push(`Finding the list of ${what} for ${subject} (fan wiki, Wikipedia or the web)`);
      continue;
    }
    const castFor = a.match(/^cast\s+\[\[(.+?)\]\]/i);
    if (castFor) {
      const film = findCard(castFor[1]);
      const name = film ? (film.data.query ?? film.data.title) : castFor[1];
      void api
        .cast(name)
        .then((c) => {
          const id = addClue('gallery', { title: `Who's who in ${c.title}`, listLabel: c.label ?? 'Cast & crew', url: c.url, source: 'wikipedia', items: c.items, text: c.director.length ? `Directed by ${c.director.join(', ')}` : undefined }, { near: film?.id ?? near, tie: true });
          useUi.getState().log(`🎬 Who's who in ${c.title}: ${c.items.length} ${c.label === 'Cast & crew' || !c.label ? 'people and their parts' : c.label.toLowerCase()}`, 'ok');
          return id;
        })
        .catch((e) => useUi.getState().log(`Couldn't find a cast list for “${name}”: ${e instanceof Error ? e.message : e}`, 'warn'));
      done.push(`Pulling the cast of “${name}”`);
      continue;
    }
    const fill = a.match(/^fill\s+\[\[(.+?)\]\]/i);
    if (fill) {
      const card = findCard(fill[1]);
      if (card?.type === 'gallery') {
        const title = card.data.title;
        void fillGallery(card.id)
          .then((n) => useUi.getState().log(`🗂 “${title}” now shows all ${n}`, 'ok'))
          .catch((e) => useUi.getState().log(`Couldn't read the list for “${title}”: ${e instanceof Error ? e.message : e}`, 'warn'));
        done.push(`Adding everyone on the “${title}” list from its wiki page`);
      }
      continue;
    }
    const photo = a.match(/^photo\s+\[\[(.+?)\]\](?:\s*:\s*#?(\d+))?/i);
    if (photo) {
      const card = findCard(photo[1]);
      if (!card) continue;
      const src = photo[2] ? sources[Number(photo[2]) - 1] : undefined;
      if (src?.image) {
        useBoards.getState().snapshot(`Photo on “${card.data.title}”`);
        useBoards.getState().updateNode(card.id, { image: src.image });
        done.push(`Put a photo on “${card.data.title}”`);
      } else if (!photo[2]) {
        void pictureFor(card.id, card.data.title, near);
        done.push(`Looking up a picture for “${card.data.title}”`);
      }
      continue;
    }
    const rewrite = a.match(/^set\s+\[\[(.+?)\]\]\s*:\s*(.+)/i);
    if (rewrite) {
      const card = findCard(rewrite[1]);
      if (card) {
        useBoards.getState().snapshot(`Rewrote “${card.data.title}”`);
        useBoards.getState().updateNode(card.id, { text: rewrite[2].trim().slice(0, 600) });
        done.push(`Rewrote “${card.data.title}”`);
      }
      continue;
    }
    const cut = a.match(/^cut\s+\[\[(.+?)\]\]\s*(?:->|→|to|and|from)\s*\[\[(.+?)\]\]/i);
    if (cut) {
      const x = findCard(cut[1]);
      const y = findCard(cut[2]);
      if (x && y) {
        const strings = currentBoard().edges.filter((e) => (e.source === x.id && e.target === y.id) || (e.source === y.id && e.target === x.id));
        if (strings.length) {
          useBoards.getState().snapshot(`Cut a string`);
          strings.forEach((e) => useBoards.getState().removeEdge(e.id));
          done.push(`Cut the string between “${x.data.title}” and “${y.data.title}”`);
        }
      }
      continue;
    }
    const move = a.match(/^move\s+\[\[(.+?)\]\]\s+(?:near|next to|by|beside|to)\s+\[\[(.+?)\]\]/i);
    if (move) {
      const x = findCard(move[1]);
      const y = findCard(move[2]);
      if (x && y && x.id !== y.id) {
        const s = sizeOf(x);
        const c = freeSpot(currentBoard().nodes.filter((n) => n.id !== x.id), centerOf(y), s);
        useBoards.getState().snapshot(`Moved “${x.data.title}”`);
        useBoards.getState().updateNodes((n) => (n.id === x.id ? { ...n, position: { x: Math.round(c.x - s.w / 2), y: Math.round(c.y - s.h / 2) } } : n));
        done.push(`Moved “${x.data.title}” next to “${y.data.title}”`);
      }
      continue;
    }
    if (/^tidy\b/i.test(a)) {
      const board = currentBoard();
      const cluster = topicOf(board, board.nodes.find((n) => n.id === near))?.data.clusterId;
      const movable = new Set(board.nodes.filter((n) => n.type !== 'topic' && (!cluster || n.data.clusterId === cluster)).map((n) => n.id));
      const spots = untangle(board.nodes, movable);
      if (spots.size) {
        useBoards.getState().snapshot('Tidied the board');
        useBoards.getState().updateNodes((n) => (spots.has(n.id) ? { ...n, position: spots.get(n.id)! } : n));
        done.push('Spread out the cards so none overlap');
      }
      continue;
    }
    if (/^search\s/i.test(a)) continue; // run after the answer, as a follow-up
    // Every other kind of card, by name.
    const question = a.match(/^question\s+(.+)/i);
    if (question) {
      const t = question[1].replace(/^["“]|["”]$/g, '').trim().slice(0, 160);
      if (t) {
        made.push(addClue('question', { title: /\?$/.test(t) ? t : `${t}?` }, { near, tie: true }));
        done.push(`Added a question: “${t.slice(0, 60)}”`);
      }
      continue;
    }
    const quote = a.match(/^quote\s+["“](.+?)["”]\s*(?:[—–-]+\s*([^[]+?))?\s*(?:\[(\d+)\])?\s*$/i);
    if (quote) {
      const src = quote[3] ? sources[Number(quote[3]) - 1] : undefined;
      const who = quote[2]?.trim();
      made.push(addClue('quote', { title: who || src?.title || 'Quote', text: `“${quote[1].trim().slice(0, 500)}”`, author: who, url: src?.url, source: src?.source }, { near, tie: true }));
      done.push(`Added a quote${who ? ` from ${who}` : ''}`);
      continue;
    }
    const label = a.match(/^label\s+(.+)/i);
    if (label) {
      const t = label[1].replace(/^["“]|["”]$/g, '').trim().slice(0, 40);
      if (t) {
        made.push(addClue('label', { title: t }, { near }));
        done.push(`Added a label: “${t}”`);
      }
      continue;
    }
    const frame = a.match(/^frame\s+(.+?)\s*:\s*(.+)$/i);
    if (frame) {
      const inside = [...frame[2].matchAll(/\[\[(.+?)\]\]/g)].map((m) => findCard(m[1])).filter((n): n is NonNullable<typeof n> => !!n && n.type !== 'frame');
      if (inside.length) {
        // A frame drawn around those cards, with room for its name tab.
        const boxes = inside.map((n) => ({ ...n.position, ...sizeOf(n) }));
        const x0 = Math.min(...boxes.map((b) => b.x)) - 40;
        const y0 = Math.min(...boxes.map((b) => b.y)) - 70;
        const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + 40;
        const y1 = Math.max(...boxes.map((b) => b.y + b.h)) + 40;
        const color = FRAME_COLORS[currentBoard().nodes.filter((n) => n.type === 'frame').length % FRAME_COLORS.length];
        const id = addClue('frame', { title: frame[1].replace(/^["“]|["”]$/g, '').trim().slice(0, 40), color }, { at: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } });
        useBoards.getState().updateNodes((n) => (n.id === id ? { ...n, position: { x: x0, y: y0 }, width: x1 - x0, height: y1 - y0 } : n));
        made.push(id);
        done.push(`Drew a “${frame[1].trim().slice(0, 30)}” frame around ${inside.length} card${inside.length === 1 ? '' : 's'}`);
      }
      continue;
    }
    const placeLine = a.match(/^place\s+(.+?)(?:\s*:\s*(.+))?$/i);
    if (placeLine) {
      const name = placeLine[1].replace(/^\[\[|\]\]$|^["“]|["”]$/g, '').trim().slice(0, 120);
      const line = placeLine[2]?.trim();
      void api
        .places(name)
        .then(({ places }) => {
          const p = places[0];
          if (!p) return useUi.getState().log(`Couldn't find “${name}” on the map`, 'warn');
          const { id, existed } = pinPlace(p, { near }, line ?? '');
          if (!existed && near) useBoards.getState().addEdges([makeEdge(near, id, { kind: 'user' })]);
          useUi.getState().log(`📍 ${existed ? 'Already pinned' : 'Pinned'} “${p.name}” on the board and the map`, 'ok');
          setTimeout(() => useUi.getState().focusNodes([id], true), 300);
        })
        .catch((e) => useUi.getState().log(`Map search failed: ${e instanceof Error ? e.message : e}`, 'warn'));
      done.push(`Finding “${name}” on the map`);
      continue;
    }
    const mapLine = a.match(/^map\s+(.+?)\s*:\s*(.+)$/i);
    if (mapLine) {
      // Places are split by ";" (or "|"); a plain comma list of three or more works too, while two comma parts
      // stay one place ("Paris, France").
      const parts = mapLine[2].split(/\s*[;|]\s*/);
      const list = parts.length === 1 && mapLine[2].split(',').length >= 3 ? mapLine[2].split(/\s*,\s*/) : parts;
      const names = list.map((x) => x.replace(/^\[\[|\]\]$/g, '').trim()).filter(Boolean).slice(0, 12);
      const title = mapLine[1].replace(/^["“]|["”]$/g, '').trim().slice(0, 60);
      void Promise.all(names.map((n) => api.places(n).then((r) => r.places[0]).catch(() => undefined)))
        .then((found) => {
          const points = found.filter((p): p is NonNullable<typeof p> => !!p).map((p, i) => ({ lat: p.lat, lon: p.lon, label: names[found.indexOf(p)] ?? p.name ?? String(i), from: 'mine' as const }));
          if (!points.length) return useUi.getState().log(`None of those places were found on the map`, 'warn');
          const id = addClue('map', { title: `Map: ${title}`, points }, { near, tie: true });
          useUi.getState().log(`🗺 Map “${title}” with ${points.length} place${points.length === 1 ? '' : 's'}`, 'ok');
          setTimeout(() => useUi.getState().focusNodes([id], true), 300);
        });
      done.push(`Drawing a map of ${names.length} place${names.length === 1 ? '' : 's'}`);
      continue;
    }
    const moment = a.match(/^(?:moment|timeline)\s+(-?\d{1,4}(?:-\d{2}(?:-\d{2})?)?)\s*:\s*(.+)$/i);
    if (moment) {
      const cluster = currentBoard().nodes.find((n) => n.id === near)?.data.clusterId ?? currentBoard().nodes.find((n) => n.type === 'topic')?.data.clusterId ?? 'mine';
      useBoards.getState().snapshot('Added a moment to the timeline');
      useBoards.getState().addTimeline([{ id: nanoid(8), date: moment[1], event: moment[2].trim().slice(0, 160), clusterId: cluster }]);
      done.push(`Added ${moment[1]} to the timeline`);
      continue;
    }
    const stampLine = a.match(/^stamp\s+\[\[(.+?)\]\]\s*:\s*(.+)$/i);
    if (stampLine) {
      const target = findCard(stampLine[1]);
      const word = stampLine[2].toLowerCase();
      const st = (['confirmed', 'disputed', 'debunked', 'theory', 'key', 'lead'] as const).find((x) => word.includes(x));
      if (target && st) {
        useBoards.getState().snapshot(`Stamped “${target.data.title}”`);
        useBoards.getState().updateNode(target.id, { stamp: st });
        done.push(`Stamped “${target.data.title}” ${st === 'key' ? 'key evidence' : st}`);
      }
      continue;
    }
    const note = a.match(/^note\s+(.+)/i);
    if (note) {
      // Some models copy the instruction wording ("the text of a sticky note: …"); keep only the note.
      const body = note[1].replace(/^(the\s+)?text\s+of\s+(a|the)\s+sticky\s+note\s*:?\s*/i, '').replace(/^["“](.*)["”]$/s, '$1').trim();
      if (!body) continue;
      addClue('note', { text: body.slice(0, 400), title: body.slice(0, 60), color: '#fdf6e3' }, { near, tie: true });
      done.push('Left a sticky note');
    }
  }
  // A new card the answer didn't tie to anything hangs off the case it was asked about.
  const edges = currentBoard().edges;
  const loose = near ? created.filter((id) => !edges.some((e) => e.source === id || e.target === id)) : [];
  if (loose.length) useBoards.getState().addEdges(loose.map((id) => makeEdge(near!, id, { kind: 'user' })));
  const nearTitle = currentBoard().nodes.find((x) => x.id === near)?.data.title;
  for (const id of loose) {
    const t = currentBoard().nodes.find((x) => x.id === id)?.data.title;
    const i = done.indexOf(`Added a card for “${t}”`);
    if (i >= 0 && nearTitle) done[i] = `Added a card for “${t}” and tied it to “${nearTitle}”`;
  }
  made.push(...created);
  // Show what was just added, so you can see it landed and where it is tied.
  if (made.length) setTimeout(() => useUi.getState().focusNodes([...new Set([...made, ...(near ? [near] : [])])], true), 350);
  if (removals.size) {
    // Never empty the board by accident: the first case stays unless it was named on its own.
    useBoards.getState().removeNodes([...removals], `Cleaned up ${removals.size} card${removals.size === 1 ? '' : 's'}`);
    done.push(`Removed ${removedTitles.length > 4 ? `${removedTitles.length} items` : removedTitles.join(', ')}. One Ctrl+Z brings it all back.`);
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
                ✓ <DoneLine text={d} />
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

  const send = async (text: string, opts: { searchFor?: string[]; depth?: number; boardId?: string; offline?: boolean; allowChanges?: boolean } = {}) => {
    const q = text.trim();
    if (!q || (busy && !opts.searchFor)) return;
    const s = useBoards.getState();
    // The answer, its follow-ups and its board actions stay with this board, even if you switch away.
    const boardId = opts.boardId ?? s.currentId;
    // The partner changes the board only when you ask it to (a follow-up search keeps the original permission).
    const allowChanges = opts.allowChanges ?? WANTS_CHANGE.test(q);
    // Your own material (a photo, a document) is private: it stays off web searches unless you ask for one.
    const picked = s.boards[boardId]?.nodes.find((n) => n.id === useUi.getState().selectedNodeId);
    const ownCard = picked?.data.source === 'mine';
    if (ownCard && !opts.searchFor && !/\b(search|google|look (it |this |that )?up|online|on the web|internet|find (more|out|sources)|research)\b/i.test(q)) opts = { ...opts, offline: true };
    // The partner looks at the picture on the card asked about: a photo you added, a scanned page, a pinned photo.
    const look = picked?.data.image && (ownCard || picked.type === 'image') ? { title: picked.data.title, image: picked.data.image } : undefined;
    const history = [...(s.boards[boardId]?.chat ?? []).filter((c) => !c.error && !c.pending), { role: 'user' as const, content: q }].map((c) => ({
      role: c.role,
      content: c.role === 'assistant' ? splitAnswer(c.content).text : c.content,
    }));
    const id = nanoid(8);
    onBoard(boardId, () => {
      s.addChat({ id: nanoid(8), role: 'user', content: q });
      s.addChat({ id, role: 'assistant', content: '', pending: true, status: (research && !opts.offline) || opts.searchFor ? 'Checking the archives' : 'Thinking' });
    });
    setInput('');
    setBusy(true);
    setStuck(true);
    abort.current = new AbortController();
    const prefs = useSettings.getState();
    // Last answer's sources travel along, so "pin that picture" can point back at them.
    const carrySources = [...currentBoard().chat].reverse().find((c) => c.role === 'assistant' && c.sources?.length)?.sources?.slice(0, 10);
    try {
      await api.chat(
        onBoard(boardId, () => ({
          carrySources,
          hint: (() => {
            const b = currentBoard();
            const sel = b.nodes.find((n) => n.id === useUi.getState().selectedNodeId);
            const topic = b.nodes.filter((n) => n.type === 'topic').at(-1);
            // Your own card is not a search term: the board's case (or its name) is.
            if (!sel || sel.data.source === 'mine') return topic?.data.query ?? topic?.data.title ?? (b.name !== 'Untitled board' ? b.name : undefined);
            // A card is searched together with its case: "Buenos Aires" + "Liam Payne death".
            const card = sel.data.query ?? sel.data.title;
            const inCase = caseName(sel);
            return inCase && !card.toLowerCase().includes(inCase.toLowerCase()) && sel.type !== 'topic' ? `${card} ${inCase}` : card;
          })(),
          focus: (() => {
            const sel = currentBoard().nodes.find((n) => n.id === useUi.getState().selectedNodeId);
            return sel?.data.url && sel.type !== 'topic' && sel.data.source !== 'mine' ? { url: sel.data.url, title: sel.data.title } : undefined;
          })(),
          messages: history,
          look,
          context: prefs.chatUsesBoard ? boardContext() : undefined,
          research: (research && !opts.offline) || !!opts.searchFor?.length,
          searchFor: opts.searchFor,
          sources: prefs.searchSources.filter((x) => ['wikipedia', 'web', 'reddit', 'archive', 'hackernews', 'openalex', 'googlenews', 'youtube'].includes(x)).slice(0, 5),
        })),
        (ev) => {
          const u = (cid: string, p: Partial<ChatEntry> | ((e: ChatEntry) => Partial<ChatEntry>)) => onBoard(boardId, () => useBoards.getState().updateChat(cid, p));
          if (ev.type === 'status') u(id, { status: ev.message });
          else if (ev.type === 'sources') u(id, { sources: ev.items });
          else if (ev.type === 'delta') u(id, (c) => ({ content: c.content + ev.text }));
          else if (ev.type === 'reset') u(id, { content: '', status: 'A backup brain is finishing the answer' });
          else if (ev.type === 'error') u(id, (c) => ({ content: c.content || ev.message, error: !c.content }));
        },
        abort.current.signal,
      );
    } catch (e) {
      if (!abort.current?.signal.aborted) onBoard(boardId, () => useBoards.getState().updateChat(id, { content: e instanceof Error ? e.message : String(e), error: true }));
    } finally {
      onBoard(boardId, () => useBoards.getState().updateChat(id, { pending: false }));
      setBusy(false);
      // Now that the answer is complete, do what it asked of the board.
      const entry = useBoards.getState().boards[boardId]?.chat.find((c) => c.id === id);
      if (entry && !entry.error) {
        const { actions } = splitAnswer(entry.content);
        const allowed = allowChanges ? actions : actions.filter((a) => READ_ONLY.test(a));
        const done = onBoard(boardId, () => runActions(allowed, entry.sources ?? []));
        if (done.length) onBoard(boardId, () => useBoards.getState().updateChat(id, { done }));
        // It asked to search again: run those searches and let it finish the job (twice at most).
        const more: string[] = actions.map((a) => a.match(/^search\s+(.+)/i)?.[1]?.replace(/^["“]|["”]$/g, '').trim()).filter((x): x is string => !!x).slice(0, 3);
        // An answer that admits the sources came up short gets a real web search, not an offer of one.
        const short = /(do(es)?n['’]?t|do(es)? not|did not|didn['’]t) (contain|mention|include|cover|say|show|have)|can['’]?t (confirm|find|tell|verify|add)|cannot (confirm|find|tell|verify|add)|no (source|evidence|article)s? (on|that|about|here|so far)|not (in|on) the (board|sources)|if you['’]?d like,? (i|we) can|(i|we) can (run|do) a (targeted |web )?search/i.test(splitAnswer(entry.content).text);
        if (!more.length && short && !opts.depth && !opts.offline && !abort.current?.signal.aborted) {
          const inCase = caseName(currentBoard().nodes.find((n) => n.id === useUi.getState().selectedNodeId)) ?? currentBoard().nodes.filter((n) => n.type === 'topic').at(-1)?.data.query;
          const asked = q.replace(/\s*\(in the case of [^)]*\)\s*$/i, '').slice(0, 160);
          more.push(inCase && !asked.toLowerCase().includes(inCase.toLowerCase()) ? `${asked} ${inCase}` : asked);
        }
        if (more.length && (opts.depth ?? 0) < 2 && !abort.current?.signal.aborted) {
          void send(`🔎 Searching the web for ${more.map((m) => `“${m}”`).join(', ')}. Use what turns up to finish what I asked.`, { searchFor: more, depth: (opts.depth ?? 0) + 1, boardId, allowChanges });
        }
      }
    }
  };

  useEffect(() => {
    if (prefill) void send(prefill.text, { offline: prefill.offline, allowChanges: prefill.readOnly ? false : undefined });
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
