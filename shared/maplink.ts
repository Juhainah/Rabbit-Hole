// Map links and coordinates people paste: "48.8584, 2.2945", a Google Maps place link, an Apple Maps
// share link, an OpenStreetMap link. Read in the browser when the link says where; short share links
// (maps.app.goo.gl) are opened by the server, which follows them to the full link.

export interface LinkedPlace {
  lat?: number;
  lon?: number;
  /** The place's name when the link carries one ("/place/Eiffel+Tower/"). */
  name?: string;
}

/** Map services whose links can be read (and whose short links the server may follow). */
export const MAP_HOSTS = /(^|\.)(google\.[a-z]{2,3}(\.[a-z]{2})?|goo\.gl|maps\.app\.goo\.gl|g\.co|openstreetmap\.org|osm\.org|maps\.apple\.com|maps\.apple|apple\.co|bing\.com|waze\.com|here\.com)$/i;

const valid = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

/** Coordinates typed or pasted: "48.8584, 2.2945", "48.8584 N 2.2945 E", "-33.86,151.21". */
export function parseCoords(text: string): LinkedPlace | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (/s/i.test(m[2] ?? '')) lat = -Math.abs(lat);
  if (/w/i.test(m[4] ?? '')) lon = -Math.abs(lon);
  return valid(lat, lon) ? { lat, lon } : null;
}

/** Is this a link to a map service at all? */
export function isMapLink(text: string): boolean {
  try {
    const u = new URL(text.trim());
    // Google is a map only at maps.google.… or google.…/maps, not its web search.
    return /^https?:$/.test(u.protocol) && MAP_HOSTS.test(u.hostname) && (!/(^|\.)google\./i.test(u.hostname) || /^maps\./i.test(u.hostname) || /^\/maps\b/i.test(u.pathname));
  } catch {
    return false;
  }
}

/** A short share link that only says where once it is opened. */
export function isShortMapLink(text: string): boolean {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|apple\.co|maps\.apple\/p)\//i.test(text.trim());
}

/** Where a map link points: its pin, else its search, else the middle of its view. */
export function parseMapLink(text: string): LinkedPlace | null {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return null;
  }
  if (!MAP_HOSTS.test(u.hostname)) return null;
  let whole = u.href;
  try {
    whole = decodeURIComponent(u.href.replace(/\+/g, ' '));
  } catch {
    /* keep it as it is */
  }
  const param = (...names: string[]) => names.map((n) => u.searchParams.get(n)).find((v) => v && v.trim()) ?? '';
  // Coordinates can sit in any of these ("ll" beside a named "q" in Apple's links); a name only in the search ones.
  const askedAt = ['q', 'query', 'll', 'sll', 'daddr', 'destination', 'center'].map((n) => parseCoords(u.searchParams.get(n) ?? '')).find((p) => !!p) ?? null;
  const asked = ['q', 'query', 'daddr', 'destination', 'address', 'where1'].map((n) => u.searchParams.get(n) ?? '').find((v) => v.trim() && !parseCoords(v)) ?? '';
  const pin = whole.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const marker = u.searchParams.get('mlat') && u.searchParams.get('mlon') ? [u.searchParams.get('mlat')!, u.searchParams.get('mlon')!] : null;
  const bing = u.searchParams.get('cp')?.match(/(-?\d+(?:\.\d+)?)~(-?\d+(?:\.\d+)?)/);
  const view = whole.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const osm = whole.match(/#map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
  const out: LinkedPlace = {};
  for (const pair of [pin && [pin[1], pin[2]], marker, askedAt && [String(askedAt.lat), String(askedAt.lon)], bing && [bing[1], bing[2]], view && [view[1], view[2]], osm && [osm[1], osm[2]]]) {
    if (!pair) continue;
    const lat = Number(pair[0]);
    const lon = Number(pair[1]);
    if (valid(lat, lon)) {
      out.lat = lat;
      out.lon = lon;
      break;
    }
  }
  const placeName = whole.match(/\/place\/([^/@?#]+)/)?.[1];
  const name = (placeName ?? asked).replace(/\+/g, ' ').trim() || param('name', 'title');
  if (name) out.name = name.slice(0, 120);
  return out.lat != null || out.name ? out : null;
}
