import type { EntityType } from '../../shared/types';
import type { ClueNode, ClueType } from '../types';

export const ENTITY_COLORS: Record<EntityType, string> = {
  person: '#dca83f',
  place: '#5f9e6e',
  org: '#3f7f86',
  event: '#c8322f',
  concept: '#7e5a9b',
  object: '#b8743a',
  work: '#c85a8a',
  date: '#caa53b',
};

export const ENTITY_LABEL: Record<EntityType, string> = {
  person: 'Person',
  place: 'Place',
  org: 'Organisation',
  event: 'Event',
  concept: 'Concept',
  object: 'Object',
  work: 'Work',
  date: 'Date',
};

export const TYPE_COLORS: Record<ClueType, string> = {
  topic: '#e7c98a',
  entity: '#dca83f',
  note: '#f7de6b',
  image: '#e9e4d8',
  clip: '#cfc4ad',
  post: '#ff6a3d',
  video: '#ff3355',
  tangent: '#9b6fd0',
  question: '#e25b4f',
  quote: '#9aa0a6',
  map: '#6fa8a0',
  label: '#f5efe2',
};

export const TYPE_LABEL: Record<ClueType, string> = {
  topic: 'Case file',
  entity: 'Index card',
  note: 'Sticky note',
  image: 'Photo',
  clip: 'Clipping',
  post: 'Forum post',
  video: 'Tape',
  tangent: 'Rabbit hole',
  question: 'Question',
  quote: 'Quote',
  map: 'Map',
  label: 'Scrap label',
};

export const PIN_COLORS = ['#c8322f', '#1f1f1f', '#2f5fb3', '#e0a526', '#3f8f55', '#f2f2f2', '#9b4dca'];
export const NOTE_COLORS = ['#f7de6b', '#f6b8a8', '#b9dcb0', '#a9d3e8', '#e3c7f0', '#fdf6e3'];
export const STRING_COLORS = ['#c8322f', '#1f1f1f', '#2f5fb3', '#e0a526', '#3f8f55', '#9b4dca', '#f4f1e6'];

export function nodeColor(n: Pick<ClueNode, 'type' | 'data'>): string {
  if (n.data.color) return n.data.color;
  if (n.type === 'entity' && n.data.entityType) return ENTITY_COLORS[n.data.entityType];
  return TYPE_COLORS[(n.type ?? 'note') as ClueType] ?? '#999';
}

/** Deterministic pseudo-random in [0,1) from a string. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export const jitterRot = (id: string, max = 3.2) => +((hash01(id) * 2 - 1) * max).toFixed(2);

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function domain(url?: string) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

/** Best-effort year from messy dates: "1959", "1959-02-01", "c. 1404", "500 BC", "Feb 2, 1959". */
export function yearOf(date?: string | null): number | null {
  if (!date) return null;
  const s = String(date).trim();
  const bc = /\b(BC|BCE)\b/i.test(s);
  const neg = s.match(/^-(\d{1,5})/);
  if (neg) return -parseInt(neg[1], 10);
  const m = s.match(/\b(\d{3,4})\b/) ?? s.match(/\b(\d{1,4})\s*(BC|BCE)\b/i);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  if (!bc && y > new Date().getFullYear() + 5) return null;
  return bc ? -y : y;
}

export function prettyDate(date?: string | null): string {
  if (!date) return '';
  const y = yearOf(date);
  const iso = String(date).match(/^(-?\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (iso) {
    const [, yy, mm, dd] = iso;
    return dd ? `${dd}/${mm}/${yy}` : `${mm}/${yy}`;
  }
  if (y != null && y < 0) return `${-y} BC`;
  if (y != null) return String(y);
  const s = String(date).trim();
  return s.length > 12 ? `${s.slice(0, 11)}…` : s;
}

export function compact(n: number | string | undefined): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (!Number.isFinite(v)) return String(n ?? '');
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(v);
}

// Web-mercator helpers for the paper maps pinned on the board.
export function lonLatToWorld(lat: number, lon: number, z: number) {
  const n = 256 * 2 ** z;
  const rad = (clamp(lat, -85, 85) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

/** Esri's National Geographic basemap: keyless, and it looks like an old explorer's map. */
export const TILE_URL = (z: number, x: number, y: number) => {
  const n = 2 ** z;
  const wx = ((x % n) + n) % n;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/${z}/${y}/${wx}`;
};

/** Keyless basemaps for the full Map view. */
export const MAP_STYLES = {
  explorer: {
    name: 'Explorer',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; National Geographic, Esri, DeLorme, NAVTEQ, UNEP-WCMC, USGS, NASA, ESA, METI, NRCAN, GEBCO, NOAA, iPC',
    maxZoom: 16,
  },
  streets: {
    name: 'Streets',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  topo: {
    name: 'Topo',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
  },
  night: {
    name: 'Night',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    maxZoom: 16,
  },
} as const;

export type MapStyle = keyof typeof MAP_STYLES;

export interface TileLayout {
  zoom: number;
  tiles: { key: string; src: string; left: number; top: number }[];
  project: (lat: number, lon: number) => { x: number; y: number };
}

/** Picks a zoom that fits every point in a w×h box and lists the tiles to draw. */
export function layoutTiles(points: { lat: number; lon: number }[], w: number, h: number, maxZoom = 11): TileLayout {
  let zoom = points.length <= 1 ? 6 : 2;
  if (points.length > 1) {
    for (let z = maxZoom; z >= 1; z--) {
      const px = points.map((p) => lonLatToWorld(p.lat, p.lon, z));
      const xs = px.map((p) => p.x);
      const ys = px.map((p) => p.y);
      if (Math.max(...xs) - Math.min(...xs) < w * 0.72 && Math.max(...ys) - Math.min(...ys) < h * 0.66) {
        zoom = z;
        break;
      }
    }
  }
  const px = points.map((p) => lonLatToWorld(p.lat, p.lon, zoom));
  const cx = px.length ? (Math.min(...px.map((p) => p.x)) + Math.max(...px.map((p) => p.x))) / 2 : lonLatToWorld(20, 0, zoom).x;
  const cy = px.length ? (Math.min(...px.map((p) => p.y)) + Math.max(...px.map((p) => p.y))) / 2 : lonLatToWorld(20, 0, zoom).y;
  const left = cx - w / 2;
  const top = cy - h / 2;
  const tiles: TileLayout['tiles'] = [];
  const maxTile = 2 ** zoom - 1;
  for (let tx = Math.floor(left / 256); tx <= Math.floor((left + w) / 256); tx++) {
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + h) / 256); ty++) {
      if (ty < 0 || ty > maxTile) continue;
      tiles.push({ key: `${zoom}-${tx}-${ty}`, src: TILE_URL(zoom, tx, ty), left: tx * 256 - left, top: ty * 256 - top });
    }
  }
  return {
    zoom,
    tiles,
    project: (lat, lon) => {
      const p = lonLatToWorld(lat, lon, zoom);
      return { x: p.x - left, y: p.y - top };
    },
  };
}
