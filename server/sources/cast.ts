import type { SourceItem } from '../../shared/types';
import { getJson, stripHtml, UA } from '../http';

// Who is in a film or series, and who they play: the cast list from its Wikipedia article
// ("Madhuri Dixit as Begum Para"), the director from its infobox, and each actor's photo.

export interface Cast {
  /** The article's title ("Dedh Ishqiya"). */
  title: string;
  url: string;
  director: string[];
  /** One per actor: title = actor, meta.role = the character. */
  items: SourceItem[];
  /** What the list is: a work's cast, a band's or group's members, or an organisation's people. */
  label: string;
  /** Articles named after this one that the lead links ("Big Time Rush (TV series)" from the band). */
  siblings: string[];
}

const wiki = (params: Record<string, string>, signal?: AbortSignal) =>
  getJson<any>(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', redirects: '1', ...params })}`, {
    headers: { 'User-Agent': UA },
    timeout: 9000,
    signal,
  });

// Infobox rows naming the people behind a work, and what to call their job on the card.
// Labels arrive with "(s)" removed, so "Director(s)" reads "Director"; plurals are allowed too.
const CREW: [RegExp, string][] = [
  [/^(directed by|directors?)$/i, 'Director'],
  [/^(created by|creators?)$/i, 'Creator'],
  [/^(showrunners?)$/i, 'Showrunner'],
  [/^authors?$/i, 'Author'],
  [/^(written by|screenplay by|story by|teleplay by|writers?)$/i, 'Writer'],
  [/^(music by|composers?)$/i, 'Music'],
  [/^(produced by|producers?)$/i, 'Producer'],
  [/^(designers?)$/i, 'Designer'],
  [/^(illustrators?|illustrated by|artists?)$/i, 'Illustrator'],
  [/^(developers?)$/i, 'Developer'],
];

/** "(TV series)", "(film)", "(2010 video game)": a work you can cast, not an album, a song or a disambiguation page. */
const SCREEN_KIND = /\((?:\d{4} )?(?:american |british |japanese |korean |indian )?(tv series|television series|series|film|movie|miniseries|web series|anime|manga|novel|book|video game|game|musical|play|show|tv show|sitcom)\)$/i;

/** A name as the infobox shows it, without footnote marks, language tags or season notes. */
const cleanName = (n: string) => n.replace(/\s*\[[^\]]*\]/g, '').replace(/\s*\([^)]*\)/g, '').replace(/^List\s+(?=[A-Z])/, '').replace(/\s+/g, ' ').trim();

/** Is this article about a band, group, team or company: something with members? Judged by its first sentence. */
export function isGroup(extract: string): boolean {
  const first = extract.slice(0, 260);
  return /\b(is|was|are|were) an? [^.]{0,90}?\b(band|boy band|girl group|boy group|idol group|pop group|rock group|vocal group|group|duo|trio|quartet|quintet|ensemble|orchestra|choir|collective|troupe|comedy group|team|club|company|corporation|studio|organi[sz]ation|label|foundation|agency|party)\b/i.test(first);
}

/** Is this article about a film, series, book, game, play…? Judged by its first sentence. */
export function isScreenWork(extract: string): boolean {
  const first = extract.slice(0, 260);
  return /\b(is|was|are) an? [^.]{0,90}?\b(film|movie|television series|tv series|web series|miniseries|mini-series|sitcom|anime( series)?|manga( series)?|soap opera|drama series|telenovela|streaming series|musical|stage play|play|novel|novella|book series|short story|graphic novel|comic( book)?( series)?|video game|game|visual novel|franchise|opera|ballet)\b/i.test(first);
}

const text = (html: string) => stripHtml(html.replace(/<sup[\s\S]*?<\/sup>/gi, ''), 400).replace(/\s+/g, ' ').trim();
const link = (html: string) => html.match(/<a [^>]*href="\/wiki\/([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/i);

/** "Directed by" → the names in that infobox row. */
function infoboxRow(html: string, label: RegExp): { name: string; page?: string }[] {
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const th = row.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
    // "Director(s)" and "Directed by" alike.
    if (!th || !label.test(text(th[1]).replace(/\(s\)/gi, '').replace(/ /g, ' ').trim())) continue;
    const td = row.match(/<td[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '';
    const links = [...td.matchAll(/<a [^>]*href="\/wiki\/([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .filter((m) => !/^(Help|File|Category|Template|Wikipedia):/.test(decodeURIComponent(m[1])))
      .map((m) => ({ name: cleanName(text(m[2])), page: decodeURIComponent(m[1]) }));
    if (links.length) return links.filter((l) => l.name && !/^\[?\d+\]?$/.test(l.name));
    return td
      .split(/<br\s*\/?>|<\/li>/i)
      .map((x) => ({ name: cleanName(text(x)) }))
      .filter((x) => x.name);
  }
  return [];
}

/** "Dom Cobb, a professional thief…" → "Dom Cobb"; "Basanti, Veeru's love interest" → "Basanti". */
function roleOf(s: string): string | undefined {
  const r = s.replace(/\s*\([^)]*\)/g, '').split(/\s*[,;]\s+|\s+[-–—]\s+|:\s/)[0].trim();
  // A description, not a name: keep its opening words.
  const short = r.length <= 70 ? r : r.split(/\s+/).slice(0, 9).join(' ') + '…';
  return short.replace(/^["'“]+|["'”]+$/g, '').trim() || undefined;
}

/** "<li><a>Actor</a> as Character</li>" lists, and cast tables (either column order). */
function castRows(html: string): { actor: string; page?: string; role?: string }[] {
  const out: { actor: string; page?: string; role?: string }[] = [];
  for (const li of html.match(/<li[^>]*>[\s\S]*?<\/li>/gi) ?? []) {
    const body = li.replace(/^<li[^>]*>/i, '').replace(/<\/li>$/i, '').replace(/<ul[\s\S]*$/i, '');
    const plain = text(body);
    // "Leonardo DiCaprio as Dom Cobb, a thief who…": the part is the name before the description.
    const m = plain.match(/^(.{2,60}?)\s+(?:as|–|—|:)\s+(.+)$/);
    const a = link(body);
    const startsWithLink = a && plain.startsWith(text(a[2]));
    // A character list writes "Oliver Wood is a fifth-year…": the name is what comes before "is".
    const named = (startsWithLink ? text(a![2]) : m?.[1]) ?? plain.match(/^(.{2,40}?)\s+(?:is|was|are|were)\s+(.+)$/)?.[1];
    const actor = named?.split(/\s+(?:is|was|are|were)\s+/)[0].trim();
    if (!actor || actor.length > 60 || actor.split(/\s+/).length > 6) continue;
    // A part ("as Dom Cobb"), or for a character list, what the line says about them.
    const about = m?.[2] ?? (startsWithLink ? plain.slice(text(a![2]).length).replace(/^[\s,:–—-]+(is|was|are|were)?\s*/i, '') : plain.match(/\s(?:is|was|are|were)\s+(.+)$/)?.[1]);
    out.push({ actor, page: startsWithLink ? decodeURIComponent(a![1]) : undefined, role: about ? roleOf(about) : undefined });
  }
  if (out.length >= 2) return out;
  // Tables: find which column holds the actor and which the character from the header row.
  let actorCol = 0;
  let roleCol = 1;
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? [];
    if (cells.length < 2) continue;
    const heads = cells.map((c) => text(c).toLowerCase());
    if (/^<th/i.test(cells[0] ?? '') && heads.some((h) => /character|role|actor|cast|voice|played/.test(h))) {
      const r = heads.findIndex((h) => /character|role/.test(h));
      const a = heads.findIndex((h) => /actor|cast|voice|played|performer|portrayed/.test(h));
      if (r >= 0) roleCol = r;
      if (a >= 0) actorCol = a;
      continue;
    }
    const cell = cells[actorCol];
    if (!cell) continue;
    const a = link(cell);
    const actor = text(cell).replace(/\s*\(.*$/, '');
    if (!actor || actor.length > 60 || /^(actor|cast|character|role|name|english|japanese)$/i.test(actor)) continue;
    out.push({ actor, page: a ? decodeURIComponent(a[1]) : undefined, role: cells[roleCol] ? roleOf(text(cells[roleCol])) : undefined });
  }
  return out;
}

export async function castOf(page: string, signal?: AbortSignal, max = 24): Promise<Cast | null> {
  const sections = await wiki({ action: 'parse', page, prop: 'sections' }, signal).catch(() => null);
  const title: string = sections?.parse?.title ?? page;
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const all = (sections?.parse?.sections ?? []) as any[];
  const named = (re: RegExp) => all.find((x) => re.test(text(String(x.line))));
  // Who plays whom (films, series, plays), else who is who (novels, games).
  const castSection =
    named(/^(cast|cast and characters|main cast|starring|voice cast|cast and crew|cast and roles|original cast|principal cast)$/i) ??
    named(/^(main )?characters?$|^characters and |^(main|principal|major) characters$|^protagonists?$/i) ??
    // A band's or group's people: "Members", "Band members", "Personnel", "Line-up".
    named(/^(members|band members|group members|current members|personnel|line-?ups?|members and line-?ups?|lineup|roster|current roster|key people|leadership)$/i);
  const isMembers = !!castSection && /members|personnel|line-?up|roster/i.test(text(String(castSection.line)));
  const isPeople = !!castSection && /key people|leadership/i.test(text(String(castSection.line)));
  const [lead, castHtml] = await Promise.all([
    wiki({ action: 'parse', page: title, section: '0', prop: 'text' }, signal).catch(() => null),
    castSection ? wiki({ action: 'parse', page: title, section: String(castSection.index), prop: 'text' }, signal).catch(() => null) : Promise.resolve(null),
  ]);
  const leadHtml = String(lead?.parse?.text ?? '');
  const director = infoboxRow(leadHtml, /^(directed by|director|directors|created by|showrunner)$/i).map((d) => d.name).slice(0, 3);
  // The people behind it, from the infobox: director, writers, author, music, developer…
  const crew: { actor: string; page?: string; role: string }[] = [];
  for (const [label, job] of CREW) {
    for (const p of infoboxRow(leadHtml, label).slice(0, 2)) {
      if (crew.length < 8 && !crew.some((c) => c.actor === p.name) && p.name.length <= 60) crew.push({ actor: p.name, page: p.page, role: job });
    }
  }
  let rows = castSection ? castRows(String(castHtml?.parse?.text ?? '')) : [];
  let label = isMembers ? 'Members' : isPeople ? 'Key people' : 'Cast & crew';
  // No cast section: the infobox's "Starring" names, without their parts.
  if (rows.length < 2) rows = infoboxRow(leadHtml, /^(starring|voices of)$/i).map((x) => ({ actor: x.name, page: x.page }));
  // A band or group: the infobox's members, then its past members.
  if (rows.length < 2) {
    const now = infoboxRow(leadHtml, /^(members|current members)$/i).map((x) => ({ actor: x.name, page: x.page, role: 'Member' }));
    const past = infoboxRow(leadHtml, /^(past members|former members)$/i).map((x) => ({ actor: x.name, page: x.page, role: 'Former member' }));
    if (now.length + past.length >= 2) {
      rows = [...now, ...past];
      label = 'Members';
    }
  }
  // An organisation: its founders and key people.
  if (rows.length < 2) {
    const people = [
      ...infoboxRow(leadHtml, /^(founders?|founded by)$/i).map((x) => ({ actor: x.name, page: x.page, role: 'Founder' })),
      ...infoboxRow(leadHtml, /^(key people)$/i).map((x) => ({ actor: x.name, page: x.page, role: undefined as string | undefined })),
    ].filter((x, i, all) => all.findIndex((y) => y.actor === x.actor) === i);
    if (people.length >= 2) {
      rows = people;
      label = 'Key people';
    }
  }
  // Works named after this one that the lead links: the series a band was made for, the film of a book.
  const base = title.replace(/\s*\([^)]*\)$/, '');
  const siblings = [...new Set([...leadHtml.matchAll(/href="\/wiki\/([^"#?]+)"/g)].map((m) => decodeURIComponent(m[1]).replace(/_/g, ' ')))]
    .filter((t) => t !== title && t.startsWith(base + ' (') && SCREEN_KIND.test(t.slice(base.length)))
    .slice(0, 2);
  if (rows.length < 2 && crew.length < 2) return siblings.length ? { title, url, director, items: [], label, siblings } : null;
  rows = rows.filter((r) => !crew.some((c) => c.actor === r.actor && !r.role)).slice(0, max);
  const people = [...crew, ...rows];
  // Everyone's photo from their own article.
  const pages = [...new Set(people.map((r) => r.page).filter((p): p is string => !!p))];
  const pics = new Map<string, string>();
  // No lead picture on the article (often the case for living people)? Their Wikidata photo instead.
  const wikidataFor = new Map<string, string>();
  for (let i = 0; i < pages.length; i += 50) {
    const j = await wiki({ action: 'query', titles: pages.slice(i, i + 50).join('|'), prop: 'pageimages|pageprops', ppprop: 'wikibase_item', piprop: 'thumbnail', pithumbsize: '330', pilimit: 'max' }, signal).catch(() => null);
    const alias = new Map<string, string>();
    for (const n of [...(j?.query?.normalized ?? []), ...(j?.query?.redirects ?? [])]) alias.set(n.to, n.from);
    for (const p of j?.query?.pages ?? []) {
      let key = p.title as string;
      while (alias.has(key)) key = alias.get(key)!;
      const keys = [key.replace(/_/g, ' '), p.title as string];
      if (p.thumbnail?.source) for (const k of keys) pics.set(k, p.thumbnail.source);
      else if (p.pageprops?.wikibase_item) for (const k of keys) wikidataFor.set(k, p.pageprops.wikibase_item);
    }
  }
  const missing = [...new Set(wikidataFor.values())].slice(0, 50);
  if (missing.length) {
    const d = await getJson<any>(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: missing.join('|'), props: 'claims', format: 'json' })}`, { headers: { 'User-Agent': UA }, timeout: 9000, signal }).catch(() => null);
    for (const [k, qid] of wikidataFor) {
      const file = d?.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (file) pics.set(k, `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(file).replace(/ /g, '_'))}?width=330`);
    }
  }
  const isCrew = new Set(crew.map((c) => c.actor));
  const items: SourceItem[] = people.map((r) => {
    const pageTitle = r.page?.replace(/_/g, ' ');
    const job = isCrew.has(r.actor) && crew.find((c) => c.actor === r.actor)?.role === r.role;
    return {
      id: `cast:${title}:${r.actor}:${r.role ?? ''}`,
      source: 'wikipedia',
      kind: 'image',
      title: r.actor,
      snippet: job ? `${r.role} of ${title}: ${r.actor}` : label !== 'Cast & crew' ? `${r.actor}${r.role ? ` (${r.role})` : ''} of ${title}` : r.role ? `${r.actor} plays ${r.role} in ${title}` : `${r.actor} in ${title}`,
      url: r.page ? `https://en.wikipedia.org/wiki/${r.page}` : url,
      image: pageTitle ? pics.get(pageTitle) : undefined,
      meta: r.role ? { role: r.role, ...(job ? { job: 1 } : {}) } : undefined,
    };
  });
  return { title, url, director, items, label, siblings };
}
