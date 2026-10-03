import { enc, getJson, stripHtml, throttle } from '../http';
import { num, type SearchFn } from './types';

// Nominatim's usage policy is max 1 request per second. Photon (Komoot, also
// OpenStreetMap data) is the backup when Nominatim says no.
const nominatimQueue = throttle(1100);
const geoCache = new Map<string, { lat: number; lon: number } | null>();

interface Place {
  name: string;
  full: string;
  lat: number;
  lon: number;
  url: string;
  type: string;
}

async function nominatim(q: string, limit: number, signal?: AbortSignal): Promise<Place[]> {
  const j = await nominatimQueue(() =>
    getJson<any[]>(`https://nominatim.openstreetmap.org/search?q=${enc(q)}&format=jsonv2&limit=${limit}&accept-language=en`, {
      signal,
    }),
  );
  return j.map((p) => ({
    name: p.name || p.display_name.split(',')[0],
    full: p.display_name,
    lat: +p.lat,
    lon: +p.lon,
    url: `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}`,
    type: `${p.category ?? p.class}/${p.type}`,
  }));
}

async function photon(q: string, limit: number, signal?: AbortSignal): Promise<Place[]> {
  const j = await getJson(`https://photon.komoot.io/api/?q=${enc(q)}&limit=${limit}&lang=en`, { signal });
  const T: Record<string, string> = { N: 'node', W: 'way', R: 'relation' };
  return (j.features ?? []).map((f: any) => {
    const p = f.properties ?? {};
    return {
      name: p.name ?? q,
      full: [p.name, p.city, p.state, p.country].filter(Boolean).join(', '),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      url: `https://www.openstreetmap.org/${T[p.osm_type] ?? 'node'}/${p.osm_id}`,
      type: `${p.osm_key}/${p.osm_value}`,
    };
  });
}

async function findPlaces(q: string, limit: number, signal?: AbortSignal): Promise<Place[]> {
  try {
    const r = await nominatim(q, limit, signal);
    if (r.length) return r;
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  return photon(q, limit, signal);
}

/** The name of the place at a spot (a pin dropped on the map). */
export async function reverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<{ name: string; full: string; url: string } | null> {
  try {
    const p = await nominatimQueue(() => getJson<any>(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=16&accept-language=en`, { signal }));
    if (p?.display_name) {
      return { name: p.name || String(p.display_name).split(',')[0], full: String(p.display_name), url: p.osm_type ? `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}` : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}` };
    }
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  const j = await getJson<any>(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=en`, { signal }).catch(() => null);
  const f = j?.features?.[0]?.properties;
  if (!f) return null;
  return { name: f.name ?? f.street ?? f.city ?? 'Dropped pin', full: [f.name, f.street, f.city, f.state, f.country].filter(Boolean).join(', '), url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}` };
}

/** Places matching a name, with their full address: suggestions while you type. */
export async function placeSuggestions(q: string, limit: number, signal?: AbortSignal) {
  return findPlaces(q, limit, signal);
}

export async function geocode(name: string, signal?: AbortSignal): Promise<{ lat: number; lon: number } | null> {
  const key = name.trim().toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key)!;
  const [hit] = await findPlaces(name, 1, signal);
  const out = hit ? { lat: hit.lat, lon: hit.lon } : null;
  geoCache.set(key, out);
  return out;
}

export const places: SearchFn = async (q, { limit, signal }) =>
  (await findPlaces(q, limit, signal)).map((p) => ({
    id: `places:${p.url}`,
    source: 'places',
    kind: 'place' as const,
    title: p.name,
    snippet: p.full,
    url: p.url,
    lat: p.lat,
    lon: p.lon,
    meta: { type: p.type },
  }));

export const inaturalist: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(`https://api.inaturalist.org/v1/taxa?q=${enc(q)}&per_page=${limit}`, { signal });
  return (j.results ?? []).map((t: any) => ({
    id: `inaturalist:${t.id}`,
    source: 'inaturalist',
    kind: 'entity' as const,
    title: t.preferred_common_name ? `${t.preferred_common_name} (${t.name})` : t.name,
    snippet: stripHtml(t.wikipedia_summary, 300) || `${t.rank} · ${t.observations_count ?? 0} observations`,
    image: t.default_photo?.medium_url,
    url: `https://www.inaturalist.org/taxa/${t.id}`,
    meta: { rank: t.rank, observations: num(t.observations_count) ?? 0 },
  }));
};
