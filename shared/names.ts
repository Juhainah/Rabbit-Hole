// Recognising when a piece of text mentions a card: "Leonid Kulik", "Kulik",
// "the CasaSur Palermo Hotel" for a card called "CasaSur Hotel", but never
// "black" for a man called Jack Black.

export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

export const tokenize = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const LINK_WORDS = new Set(['the', 'of', 'and', 'a', 'an', 'in', 'on', 'at', 'de', 'la', 'le', 'du', 'der', 'van', 'von', 'da', 'di', 'del', 'el']);

// Words that are only a name when attached to another word.
const GENERIC = new Set([
  'union', 'states', 'state', 'city', 'river', 'lake', 'event', 'incident', 'house', 'church', 'party', 'army', 'force',
  'group', 'report', 'theory', 'company', 'hotel', 'station', 'national', 'museum', 'university', 'institute', 'society',
  'mount', 'island', 'bay', 'street', 'road', 'north', 'south', 'east', 'west', 'new', 'old', 'great', 'first', 'second',
]);

// Surnames that are also everyday words: matching them alone would link nonsense.
const WORDY_SURNAMES = new Set([
  'black', 'white', 'brown', 'green', 'gray', 'grey', 'young', 'king', 'long', 'hill', 'wood', 'woods', 'stone', 'rose',
  'wolf', 'fox', 'lamb', 'bell', 'hall', 'wall', 'ward', 'cook', 'baker', 'price', 'rich', 'little', 'small', 'strong',
  'best', 'love', 'hope', 'grant', 'church', 'bishop', 'pope', 'major', 'marshal', 'sharp', 'swift', 'wise', 'moon',
  'star', 'sun', 'day', 'may', 'march', 'summer', 'winter', 'frost', 'snow', 'rain', 'river', 'lake', 'field', 'fields',
  'ford', 'bush', 'north', 'west', 'english', 'french', 'irish', 'power', 'story', 'case', 'mark', 'page', 'lord', 'law',
]);

export type Matcher = (tokens: string[]) => boolean;

/** Builds a matcher for a card title. People also match on a distinctive surname. */
export function nameMatcher(title: string, person = false): Matcher {
  const words = tokenize(title.replace(/\s*\(.*?\)\s*/g, ' ')).filter((w) => !LINK_WORDS.has(w));
  if (!words.length) return () => false;
  const key = words.filter((w) => w.length >= 3);
  const distinctive = key.filter((w) => !GENERIC.has(w));
  const surname = person && words.length > 1 ? words.at(-1)! : undefined;
  const useSurname = surname && surname.length >= 4 && !WORDY_SURNAMES.has(surname) && !GENERIC.has(surname);

  return (tokens) => {
    if (!tokens.length) return false;
    const at = (w: string) => {
      const out: number[] = [];
      tokens.forEach((t, i) => (t === w || t === `${w}s` ? out.push(i) : undefined));
      return out;
    };
    if (useSurname && at(surname!).length) return true;
    // A one-word name must stand alone and be distinctive ("Kholat", not "Station").
    if (words.length === 1) return words[0].length >= 3 && !GENERIC.has(words[0]) && at(words[0]).length > 0;
    // Otherwise every key word, close together, in any order ("Palermo CasaSur Hotel").
    const need = key.length ? key : words;
    if (!distinctive.length && need.length < 2) return false;
    const lists = need.map(at);
    if (lists.some((l) => !l.length)) return false;
    // Close together: a two-word name may have at most one word between its parts.
    const span = need.length;
    return lists[0].some((p) => lists.every((l) => l.some((q) => Math.abs(q - p) <= span)));
  };
}
