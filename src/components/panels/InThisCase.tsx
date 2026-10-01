import { useMemo, useState } from 'react';
import type { ScrapeResult } from '../../../shared/types';
import { caseName, topicOf } from '../../lib/dig';
import { nameMatcher, tokenize } from '../../lib/names';
import { TYPE_LABEL } from '../../lib/utils';
import { currentBoard } from '../../store/boards';
import { useUi } from '../../store/ui';
import type { ClueNode, ClueType } from '../../types';

// Words that describe a case rather than name it ("… conspiracy theories").
const FILLER = new Set(['the', 'and', 'conspiracy', 'conspiracies', 'theory', 'theories', 'theroies', 'mystery', 'case', 'death', 'incident', 'story', 'hoax', 'legend', 'rumor', 'rumors', 'truth', 'what', 'why', 'how', 'who']);

const title = (n: ClueNode) => n.data.title || TYPE_LABEL[n.type as ClueType];
const fly = (id: string) => {
  useUi.getState().select(id);
  useUi.getState().focusNodes([id]);
};

/**
 * Reading an index card's background page ("FBI", "Apple App Store") from inside a case:
 * first what the card means in this case, then where the page itself mentions the case,
 * or a plain note that it's only general background.
 */
export function InThisCase({ node, page }: { node: ClueNode; page: ScrapeResult }) {
  const [open, setOpen] = useState(true);
  const facts = useMemo(() => {
    const board = currentBoard();
    const topic = topicOf(board, node);
    const subject = caseName(node);
    if (!topic || !subject || topic.id === node.id) return null;
    const inCase = board.nodes.filter((n) => n.data.clusterId === node.data.clusterId && n.id !== node.id);
    const strings = board.edges
      .filter((e) => e.source === node.id || e.target === node.id)
      .map((e) => ({ e, other: board.nodes.find((n) => n.id === (e.source === node.id ? e.target : e.source)) }))
      .filter((x): x is { e: (typeof x)['e']; other: ClueNode } => !!x.other && x.other.type !== 'map')
      .slice(0, 8);
    // Evidence on the board that names this card.
    const mentions = nameMatcher(node.data.title, node.data.entityType === 'person');
    const evidence = inCase
      .filter((n) => ['clip', 'post', 'video', 'image', 'quote'].includes(String(n.type)) && mentions(tokenize(`${n.data.title} ${n.data.text ?? ''}`)))
      .slice(0, 5);
    // Passages of this page about the case: they name its subject or someone/something else in it.
    const subjectWords = tokenize(subject).filter((w) => w.length >= 3 && !FILLER.has(w));
    const others = inCase
      .filter((n) => n.type === 'entity' && !n.data.kind)
      .map((n) => ({ name: n.data.title, match: nameMatcher(n.data.title, n.data.entityType === 'person') }));
    const passages: { text: string; why: string }[] = [];
    for (const p of page.text.split(/\n{2,}|\n(?=[A-Z])/)) {
      if (passages.length >= 3) break;
      const toks = tokenize(p);
      if (toks.length < 8) continue;
      const own = subjectWords.filter((w) => toks.includes(w)).length;
      const named = own >= Math.min(2, subjectWords.length) ? subject : others.find((o) => o.match(toks))?.name;
      if (named) passages.push({ text: p.trim().slice(0, 600), why: named });
    }
    return { topic, subject, strings, evidence, passages };
  }, [node, page]);

  if (!facts) return null;
  const { topic, subject, strings, evidence, passages } = facts;

  return (
    <section className="mb-4 rounded-lg border border-[#c8322f]/25 bg-[#fffdf7] p-3.5 shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-baseline justify-between gap-2 text-left" aria-expanded={open}>
        <span className="label-caps !text-[#b3261e]">In your case</span>
        <span className="font-ui text-[11.5px] text-ink-soft">{open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-2.5 font-ui text-[13.5px] leading-relaxed text-ink">
          <p>
            <b>{title(node)}</b> in{' '}
            <button className="underline decoration-dotted underline-offset-2 hover:text-[#b3261e]" onClick={() => fly(topic.id)}>
              {subject}
            </button>
            {node.data.text ? `: ${node.data.text}` : '.'}
          </p>
          {strings.length > 0 && (
            <div>
              <div className="mb-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-soft">Tied to</div>
              <ul className="space-y-0.5">
                {strings.map(({ e, other }) => (
                  <li key={e.id}>
                    <button className="text-left hover:text-[#b3261e]" onClick={() => fly(other.id)}>
                      {e.data?.label && <span className="font-hand text-[16px] text-[#b3261e]">{e.data.label} </span>}
                      {title(other)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {evidence.length > 0 && (
            <div>
              <div className="mb-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-soft">Evidence on your board that mentions it</div>
              <ul className="space-y-0.5">
                {evidence.map((n) => (
                  <li key={n.id}>
                    <button className="text-left hover:text-[#b3261e]" onClick={() => fly(n.id)}>
                      {title(n)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="mb-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-soft">What this page says about it</div>
            {passages.length ? (
              passages.map((p, i) => (
                <blockquote key={i} className="mt-1 border-l-2 border-[#c8322f]/50 pl-2.5 font-serif text-[13.5px] text-ink/85">
                  {p.text}
                  <span className="mt-0.5 block font-ui text-[11px] text-ink-soft">mentions {p.why}</span>
                </blockquote>
              ))
            ) : (
              <p className="text-ink-soft">
                This page never mentions {subject}. It's general background on {page.title}; the case details are in the cards above.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
