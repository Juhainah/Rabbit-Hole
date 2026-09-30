import { XMLParser } from 'fast-xml-parser';
import { CONTACT, enc, getJson, getText, stripHtml, throttle } from '../http';
import { arr, num, type SearchFn } from './types';

const MAILTO = CONTACT || 'rabbit-hole-app@users.noreply.github.com';
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function invertedAbstract(idx?: Record<string, number[]>): string {
  if (!idx) return '';
  const words: string[] = [];
  for (const [w, positions] of Object.entries(idx)) for (const p of positions) words[p] = w;
  return words.filter(Boolean).slice(0, 80).join(' ');
}

export const openalex: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    `https://api.openalex.org/works?search=${enc(q)}&per-page=${limit}&mailto=${MAILTO}&select=id,display_name,publication_year,doi,authorships,primary_location,abstract_inverted_index,cited_by_count`,
    { signal },
  );
  return (j.results ?? []).map((w: any) => ({
    id: `openalex:${w.id}`,
    source: 'openalex',
    kind: 'paper' as const,
    title: stripHtml(w.display_name, 200),
    snippet: stripHtml(invertedAbstract(w.abstract_inverted_index), 400),
    url: w.doi ?? w.id,
    date: w.publication_year ? String(w.publication_year) : undefined,
    author: (w.authorships ?? [])
      .slice(0, 3)
      .map((a: any) => a.author?.display_name)
      .filter(Boolean)
      .join(', '),
    meta: {
      cited: w.cited_by_count ?? 0,
      ...(w.primary_location?.source?.display_name ? { in: w.primary_location.source.display_name } : {}),
    },
  }));
};

export const arxiv: SearchFn = async (q, { limit, signal }) => {
  const terms = q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `all:${enc(w)}`)
    .join('+AND+');
  const text = await getText(
    `https://export.arxiv.org/api/query?search_query=${terms}&max_results=${limit}&sortBy=relevance`,
    { signal, headers: { Accept: 'application/atom+xml' } },
  );
  const feed = xml.parse(text).feed ?? {};
  return arr(feed.entry).map((e: any) => ({
    id: `arxiv:${e.id}`,
    source: 'arxiv',
    kind: 'paper' as const,
    title: String(e.title).replace(/\s+/g, ' ').trim(),
    snippet: stripHtml(String(e.summary ?? ''), 400),
    url: String(e.id),
    date: String(e.published ?? '').slice(0, 10),
    author: arr(e.author)
      .slice(0, 3)
      .map((a: any) => a.name)
      .join(', '),
  }));
};

export const crossref: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    `https://api.crossref.org/works?query=${enc(q)}&rows=${limit}&select=DOI,title,author,issued,container-title,abstract,URL,is-referenced-by-count&mailto=${MAILTO}`,
    { signal },
  );
  return (j.message?.items ?? []).map((w: any) => ({
    id: `crossref:${w.DOI}`,
    source: 'crossref',
    kind: 'paper' as const,
    title: stripHtml(w.title?.[0], 200) || w.DOI,
    snippet: stripHtml(w.abstract, 400),
    url: w.URL ?? `https://doi.org/${w.DOI}`,
    date: w.issued?.['date-parts']?.[0]?.filter(Boolean).join('-'),
    author: (w.author ?? [])
      .slice(0, 3)
      .map((a: any) => [a.given, a.family].filter(Boolean).join(' '))
      .join(', '),
    meta: { cited: w['is-referenced-by-count'] ?? 0, ...(w['container-title']?.[0] ? { in: w['container-title'][0] } : {}) },
  }));
};

export const europepmc: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(q)}&format=json&pageSize=${limit}&resultType=core`,
    { signal },
  );
  return (j.resultList?.result ?? []).map((r: any) => ({
    id: `europepmc:${r.source}:${r.id}`,
    source: 'europepmc',
    kind: 'paper' as const,
    title: stripHtml(r.title, 200),
    snippet: stripHtml(r.abstractText, 400),
    url: `https://europepmc.org/article/${r.source}/${r.id}`,
    date: r.pubYear,
    author: stripHtml(r.authorString, 80),
    meta: { cited: r.citedByCount ?? 0, ...(r.journalInfo?.journal?.title ? { in: r.journalInfo.journal.title } : {}) },
  }));
};

// Semantic Scholar allows one request a second; everyone's searches queue through this gate.
const s2Gate = throttle(1100);

export const semanticscholar: SearchFn = async (q, { limit, signal }) => {
  const headers: Record<string, string> = {};
  if (process.env.S2_API_KEY) headers['x-api-key'] = process.env.S2_API_KEY;
  const j = await s2Gate(() =>
    getJson(`https://api.semanticscholar.org/graph/v1/paper/search?query=${enc(q)}&limit=${limit}&fields=title,abstract,year,url,authors,citationCount,venue`, {
      signal,
      headers,
    }),
  );
  return (j.data ?? []).map((p: any) => ({
    id: `s2:${p.paperId}`,
    source: 'semanticscholar',
    kind: 'paper' as const,
    title: p.title,
    snippet: stripHtml(p.abstract, 400),
    url: p.url,
    date: p.year ? String(p.year) : undefined,
    author: (p.authors ?? [])
      .slice(0, 3)
      .map((a: any) => a.name)
      .join(', '),
    meta: { cited: p.citationCount ?? 0 },
  }));
};

export const zenodo: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(`https://zenodo.org/api/records?q=${enc(q)}&size=${limit}`, { signal });
  return (j.hits?.hits ?? []).map((h: any) => ({
    id: `zenodo:${h.id}`,
    source: 'zenodo',
    kind: 'dataset' as const,
    title: h.metadata?.title,
    snippet: stripHtml(h.metadata?.description, 400),
    url: h.links?.self_html ?? h.links?.html ?? `https://zenodo.org/records/${h.id}`,
    date: h.metadata?.publication_date,
    author: h.metadata?.creators?.[0]?.name,
    meta: h.metadata?.resource_type?.title ? { type: h.metadata.resource_type.title } : undefined,
  }));
};

export const oeis: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(`https://oeis.org/search?q=${enc(q)}&fmt=json`, { signal });
  const results: any[] = Array.isArray(j) ? j : (j?.results ?? []);
  return results.slice(0, limit).map((r) => {
    const a = `A${String(r.number).padStart(6, '0')}`;
    return {
      id: `oeis:${a}`,
      source: 'oeis',
      kind: 'record' as const,
      title: `${a}: ${r.name}`,
      snippet: String(r.data ?? '').slice(0, 160),
      url: `https://oeis.org/${a}`,
      meta: { refs: num(r.references) ?? 0 },
    };
  });
};
