import type { EmojiGroup } from './emojis';

// Every standard emoji, with the words people search them by (emojibase, MIT). Loaded only when the
// picker opens, so the app itself stays light.

const GROUP_NAMES: Record<number, string> = {
  0: 'Smileys',
  1: 'People',
  3: 'Animals & nature',
  4: 'Food & drink',
  5: 'Travel & places',
  6: 'Activities',
  7: 'Objects',
  8: 'Symbols & signs',
  9: 'Flags',
};

type Raw = { unicode: string; label: string; tags?: string[]; group?: number; order?: number };

let loading: Promise<EmojiGroup[]> | null = null;

/** The full set, grouped like a phone keyboard. */
export function loadAllEmojis(): Promise<EmojiGroup[]> {
  loading ??= import('emojibase-data/en/compact.json').then((m) => {
    const data = (m.default as unknown as Raw[]).filter((e) => e.group != null && GROUP_NAMES[e.group]).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const groups = new Map<number, [string, string][]>();
    for (const e of data) {
      const words = [e.label, ...(e.tags ?? [])].join(' ').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
      groups.set(e.group!, [...(groups.get(e.group!) ?? []), [e.unicode, words]]);
    }
    return [...groups].map(([g, items]) => ({ name: GROUP_NAMES[g], items }));
  });
  return loading;
}
