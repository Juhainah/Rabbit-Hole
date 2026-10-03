import { currentBoard, useBoards } from '../store/boards';
import { useUi } from '../store/ui';
import { api } from './api';
import { pinItem } from './dig';
import type { Point } from './factory';

/** A place found on the map: by name, from a map link, from coordinates, or where a pin was dropped. */
export interface FoundPlace {
  name: string;
  full: string;
  url: string;
  lat: number;
  lon: number;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

/** The card already standing for this place, if any (same link, or the same spot). */
export function cardForPlace(p: FoundPlace) {
  return currentBoard().nodes.find((n) => (p.url && n.data.url === p.url) || (n.data.lat != null && n.data.lon != null && near(n.data.lat, p.lat) && near(n.data.lon, p.lon)));
}

/** Pins a place as a card (on the board and the map); an existing card for it is returned instead. */
export function pinPlace(p: FoundPlace, opts: { near?: string; at?: Point } = {}, notes = ''): { id: string; existed: boolean } {
  const existing = cardForPlace(p);
  if (existing) return { id: existing.id, existed: true };
  const url = p.url || `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}`;
  useBoards.getState().snapshot(`Pinned ${p.name}`);
  const id = pinItem({ id: `places:${url}`, source: 'places', kind: 'place', title: p.name.slice(0, 90), snippet: p.full, url, lat: p.lat, lon: p.lon }, opts);
  if (notes.trim()) useBoards.getState().updateNode(id, { text: notes.trim().slice(0, 1200) });
  return { id, existed: false };
}

/** Puts a card that names a place onto the map, by looking its title up. */
export async function locateCard(id: string): Promise<boolean> {
  const card = currentBoard().nodes.find((n) => n.id === id);
  if (!card) return false;
  const { places } = await api.places(card.data.title);
  const hit = places[0];
  if (!hit) {
    useUi.getState().log(`Couldn't find “${card.data.title}” on the map. Drop a pin for it instead.`, 'warn');
    return false;
  }
  useBoards.getState().snapshot(`Put ${card.data.title} on the map`);
  useBoards.getState().updateNode(id, { lat: hit.lat, lon: hit.lon, entityType: card.data.entityType ?? 'place' });
  return true;
}
