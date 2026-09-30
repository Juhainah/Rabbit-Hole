import { BROWSER_UA, enc, getJson, stripHtml } from '../http';
import type { SearchFn } from './types';

const mw = (base: string, params: Record<string, string | number>) =>
  `${base}?${new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })}`;

export const courtlistener: SearchFn = async (q, { limit, signal }) => {
  const headers: Record<string, string> = {};
  if (process.env.COURTLISTENER_TOKEN) headers.Authorization = `Token ${process.env.COURTLISTENER_TOKEN}`;
  const search = (query: string) => getJson(`https://www.courtlistener.com/api/rest/v4/search/?q=${enc(query)}&type=o`, { signal, headers });
  // Search the exact phrase first ("Area 51", not every case mentioning "area" and "51"), then loosen up.
  const words = q.trim().split(/s+/);
  let j = words.length > 1 && words.length <= 4 ? await search(`"${q.replace(/"/g, '')}"`) : null;
  if (!j?.results?.length) j = await search(q);
  return (j.results ?? []).slice(0, limit).map((r: any) => ({
    id: `courtlistener:${r.cluster_id ?? r.absolute_url}`,
    source: 'courtlistener',
    kind: 'legal' as const,
    title: r.caseName ?? r.caseNameFull ?? 'Case',
    snippet: stripHtml(r.opinions?.[0]?.snippet ?? r.snippet, 320),
    url: `https://www.courtlistener.com${r.absolute_url}`,
    date: r.dateFiled,
    meta: { court: r.court ?? '', ...(r.docketNumber ? { docket: r.docketNumber } : {}) },
  }));
};

export const fedregister: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    `https://www.federalregister.gov/api/v1/documents.json?conditions[term]=${enc(q)}&per_page=${limit}&order=relevance`,
    { signal },
  );
  return (j.results ?? []).map((r: any) => ({
    id: `fedregister:${r.document_number}`,
    source: 'fedregister',
    kind: 'legal' as const,
    title: r.title,
    snippet: stripHtml(r.abstract, 320),
    url: r.html_url,
    date: r.publication_date,
    meta: { type: r.type ?? '', ...(r.agencies?.[0]?.name ? { agency: r.agencies[0].name } : {}) },
  }));
};

export const sec: SearchFn = async (q, { limit, signal }) => {
  const phrase = q.includes(' ') ? `"${q}"` : q;
  const j = await getJson(`https://efts.sec.gov/LATEST/search-index?q=${enc(phrase)}`, { signal });
  return (j.hits?.hits ?? []).slice(0, limit).map((h: any) => {
    const s = h._source ?? {};
    const [adsh, file] = String(h._id).split(':');
    const cik = String(s.ciks?.[0] ?? '').replace(/^0+/, '');
    return {
      id: `sec:${h._id}`,
      source: 'sec',
      kind: 'legal' as const,
      title: `${s.display_names?.[0] ?? 'Filing'} — ${s.form ?? s.root_forms?.[0] ?? ''}`,
      snippet: s.file_description || `${s.form} filed ${s.file_date}`,
      url: cik ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, '')}/${file}` : undefined,
      date: s.file_date,
      meta: { form: s.form ?? '' },
    };
  });
};

export const fbi: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(`https://api.fbi.gov/wanted/v1/list?title=${enc(q)}&pageSize=${limit}`, {
    signal,
    headers: { 'User-Agent': BROWSER_UA },
  });
  return (j.items ?? []).slice(0, limit).map((r: any) => ({
    id: `fbi:${r.uid}`,
    source: 'fbi',
    kind: 'record' as const,
    title: r.title,
    snippet: stripHtml(r.description || r.details || r.caution, 320),
    url: r.url,
    image: r.images?.[0]?.thumb,
    date: r.publication?.slice(0, 10),
    meta: { subjects: (r.subjects ?? []).join(', ') },
  }));
};


export const aleph: SearchFn = async (q, { limit, signal }) => {
  const headers: Record<string, string> = {};
  if (process.env.ALEPH_API_KEY) headers.Authorization = `ApiKey ${process.env.ALEPH_API_KEY}`;
  const j = await getJson(`https://aleph.occrp.org/api/2/entities?q=${enc(q)}&limit=${limit}`, { signal, headers });
  return (j.results ?? []).slice(0, limit).map((e: any) => {
    const p = e.properties ?? {};
    return {
      id: `aleph:${e.id}`,
      source: 'aleph',
      kind: 'record' as const,
      title: p.name?.[0] ?? p.title?.[0] ?? p.fileName?.[0] ?? e.schema,
      snippet: stripHtml([e.schema, p.summary?.[0] ?? p.description?.[0] ?? p.country?.join(', ')].filter(Boolean).join(' · '), 300),
      url: e.links?.ui ?? `https://aleph.occrp.org/entities/${e.id}`,
      date: p.date?.[0] ?? p.incorporationDate?.[0],
      meta: { collection: e.collection?.label ?? '' },
    };
  });
};

export const urbandictionary: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(`https://api.urbandictionary.com/v0/define?term=${enc(q)}`, { signal });
  return (j.list ?? []).slice(0, limit).map((d: any) => ({
    id: `urbandictionary:${d.defid}`,
    source: 'urbandictionary',
    kind: 'definition' as const,
    title: d.word,
    snippet: stripHtml(d.definition.replace(/[[\]]/g, ''), 320),
    url: d.permalink,
    date: d.written_on?.slice(0, 10),
    meta: { up: d.thumbs_up ?? 0 },
  }));
};

export const wikisource: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(mw('https://en.wikisource.org/w/api.php', { action: 'query', list: 'search', srsearch: q, srlimit: limit }), { signal });
  return (j.query?.search ?? []).map((s: any) => ({
    id: `wikisource:${s.pageid}`,
    source: 'wikisource',
    kind: 'record' as const,
    title: s.title,
    snippet: stripHtml(s.snippet, 300),
    url: `https://en.wikisource.org/wiki/${enc(s.title.replace(/ /g, '_'))}`,
  }));
};

