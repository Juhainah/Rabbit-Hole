import clsx from 'clsx';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { api } from '../../lib/api';
import { cardForPlace, locateCard, pinPlace, type FoundPlace } from '../../lib/places';
import { MAP_STYLES, nodeColor, prettyDate, type MapStyle } from '../../lib/utils';
import { useBoards, useCurrentBoard } from '../../store/boards';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import type { ClueNode } from '../../types';
import { PlacePicker } from '../PlacePicker';

const icon = (color: string) =>
  L.divIcon({ className: '', html: `<div class="rh-pin" style="background:${color}"></div>`, iconSize: [22, 22], iconAnchor: [11, 24], popupAnchor: [0, -22] });

/** Frames every place once when the map opens (not on every change, so a new pin doesn't yank the view). */
function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !points.length) return;
    done.current = true;
    if (points.length === 1) map.setView(points[0], 7);
    else map.fitBounds(L.latLngBounds(points), { padding: [70, 70], maxZoom: 9 });
  }, [points, map]);
  return null;
}

/** Flies to a place you just added or picked. */
function FlyTo({ to }: { to: { lat: number; lon: number; at: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (to) map.flyTo([to.lat, to.lon], Math.max(map.getZoom(), 12), { duration: 0.9 });
  }, [to, map]);
  return null;
}

/** Clicks on the map: drop a pin (in pin mode, or by right-click / long-press anywhere). */
function Clicks({ dropping, onSpot }: { dropping: boolean; onSpot: (lat: number, lon: number) => void }) {
  useMapEvents({
    click: (e) => dropping && onSpot(e.latlng.lat, e.latlng.lng),
    contextmenu: (e) => onSpot(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

type Draft = { lat: number; lon: number; name: string; full?: string; url?: string; looking: boolean };

/** Every clue with coordinates, on a real map, with strings between connected places. You can add and move places here. */
export function MapView() {
  const board = useCurrentBoard();
  const theme = useSettings((s) => s.theme);
  const dark = theme === 'void' || theme === 'chalk' || theme === 'blueprint';
  const [style, setStyle] = useState<MapStyle>(dark ? 'night' : 'explorer');
  const [dropping, setDropping] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fly, setFly] = useState<{ lat: number; lon: number; at: number } | null>(null);
  const [locating, setLocating] = useState<string | null>(null);
  const tiles = MAP_STYLES[style];
  const geo = useMemo(() => board.nodes.filter((n): n is ClueNode & { data: { lat: number; lon: number } } => n.data.lat != null && n.data.lon != null), [board.nodes]);
  // Place cards that aren't on the map yet (added by name, or taken off it).
  const unplaced = useMemo(() => board.nodes.filter((n) => n.type === 'entity' && n.data.entityType === 'place' && (n.data.lat == null || n.data.lon == null)).slice(0, 8), [board.nodes]);
  const byId = useMemo(() => new Map(geo.map((n) => [n.id, n])), [geo]);
  const lines = board.edges
    .map((e) => [byId.get(e.source), byId.get(e.target)] as const)
    .filter(([a, b]) => a && b)
    .map(([a, b]) => [[a!.data.lat, a!.data.lon], [b!.data.lat, b!.data.lon]] as [number, number][]);
  const toast = (text: string) => useUi.getState().set({ toast: { text, at: Date.now() } });

  const add = (p: FoundPlace) => {
    const { existed } = pinPlace(p);
    setFly({ lat: p.lat, lon: p.lon, at: Date.now() });
    toast(existed ? `“${p.name}” is already on your board.` : `Pinned “${p.name}” to the board and the map.`);
  };

  const spot = (lat: number, lon: number) => {
    setDropping(false);
    setDraft({ lat, lon, name: '', looking: true });
    api
      .places('', { lat, lon })
      .then((r) => setDraft((d) => (d && d.lat === lat && d.lon === lon ? { ...d, name: d.name || r.places[0]?.name || 'Dropped pin', full: r.places[0]?.full, url: r.places[0]?.url, looking: false } : d)))
      .catch(() => setDraft((d) => (d && d.lat === lat ? { ...d, name: d.name || 'Dropped pin', looking: false } : d)));
  };

  const keepDraft = () => {
    if (!draft) return;
    const name = draft.name.trim() || 'Dropped pin';
    // A pin you dropped is your own spot: it keeps your name for it, with the address underneath.
    add({ name, full: draft.full ?? `${draft.lat.toFixed(5)}, ${draft.lon.toFixed(5)}`, url: draft.url && !cardForPlace({ name, full: '', url: draft.url, lat: draft.lat, lon: draft.lon }) ? draft.url : `https://www.openstreetmap.org/?mlat=${draft.lat.toFixed(6)}&mlon=${draft.lon.toFixed(6)}`, lat: draft.lat, lon: draft.lon });
    setDraft(null);
  };

  const move = (id: string, title: string, lat: number, lon: number) => {
    useBoards.getState().snapshot(`Moved ${title} on the map`);
    useBoards.getState().updateNode(id, { lat, lon });
  };

  return (
    <div className={clsx('map-view relative h-full w-full', dropping && 'dropping')}>
      <MapContainer center={[30, 10]} zoom={2} className="h-full w-full" worldCopyJump>
        <TileLayer key={style} url={tiles.url} attribution={tiles.attribution} maxZoom={tiles.maxZoom} referrerPolicy="strict-origin-when-cross-origin" />
        <Fit points={geo.map((n) => [n.data.lat, n.data.lon])} />
        <FlyTo to={fly} />
        <Clicks dropping={dropping} onSpot={spot} />
        {lines.map((l, i) => (
          <Polyline key={i} positions={l} pathOptions={{ color: '#d23a36', weight: 2.2, dashArray: '6 6', opacity: 0.85 }} />
        ))}
        {geo.map((n) => (
          <Marker
            key={n.id}
            position={[n.data.lat, n.data.lon]}
            icon={icon(nodeColor(n))}
            draggable
            eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); move(n.id, n.data.title, ll.lat, ll.lng); } }}
          >
            <Popup>
              <div className="w-[220px]">
                {n.data.image && <img src={n.data.image} alt="" className="mb-2 h-[110px] w-full object-cover" />}
                <div className="font-type text-[15px] leading-tight">{n.data.title}</div>
                {n.data.date && <div className="font-hand text-[16px] text-[#b3261e]">{prettyDate(n.data.date)}</div>}
                {n.data.text && <p className="!my-1.5 text-[12px] leading-snug line-clamp-4">{n.data.text}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button className="chip" onClick={() => useUi.getState().focusNodes([n.id])}>
                    Show on board
                  </button>
                  <button className="chip" onClick={() => { useUi.getState().select(n.id); useUi.getState().openTab('inspect'); }}>
                    Edit
                  </button>
                  <button
                    className="chip"
                    title="Keep the card, take it off the map"
                    onClick={() => {
                      useBoards.getState().snapshot(`Took ${n.data.title} off the map`);
                      useBoards.getState().updateNode(n.id, { lat: undefined, lon: undefined });
                    }}
                  >
                    Off the map
                  </button>
                </div>
                <div className="mt-1.5 text-[10.5px] text-ink-soft">Drag the pin to move it.</div>
              </div>
            </Popup>
          </Marker>
        ))}
        {draft && <Marker position={[draft.lat, draft.lon]} icon={icon('#c8322f')} draggable eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); spot(ll.lat, ll.lng); } }} />}
      </MapContainer>

      <div className="map-tools paper-panel">
        <PlacePicker onPick={add} placeholder="Add a place: name, address, map link or coordinates" />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <button className={clsx('chip !py-1', dropping && 'on')} onClick={() => setDropping((v) => !v)} title="Then click the spot on the map. Right-click or long-press also drops a pin.">
            📍 {dropping ? 'Click the map…' : 'Drop a pin'}
          </button>
          {unplaced.length > 0 && <span className="text-[11px] text-ink-soft">Not on the map yet:</span>}
          {unplaced.map((n) => (
            <button
              key={n.id}
              className="chip !py-1"
              disabled={locating === n.id}
              title="Find this place on the map"
              onClick={() => {
                setLocating(n.id);
                locateCard(n.id)
                  .then((ok) => {
                    const c = useBoards.getState().boards[useBoards.getState().currentId]?.nodes.find((x) => x.id === n.id);
                    if (ok && c?.data.lat != null && c.data.lon != null) setFly({ lat: c.data.lat, lon: c.data.lon, at: Date.now() });
                  })
                  .catch((e) => toast(e instanceof Error ? e.message : String(e)))
                  .finally(() => setLocating(null));
              }}
            >
              {locating === n.id ? 'Finding…' : `+ ${n.data.title.slice(0, 24)}`}
            </button>
          ))}
        </div>
      </div>

      {draft && (
        <div className="map-draft paper-panel">
          <div className="font-hand text-[19px] leading-none">Pin this spot</div>
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') keepDraft();
              if (e.key === 'Escape') setDraft(null);
            }}
            placeholder={draft.looking ? 'Looking up this spot…' : 'Name it'}
            className="add-input"
          />
          <div className="text-[11px] leading-snug text-ink-soft">{draft.full ?? `${draft.lat.toFixed(5)}, ${draft.lon.toFixed(5)}`}</div>
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button className="chip" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="chip on" onClick={keepDraft}>
              Pin it
            </button>
          </div>
        </div>
      )}

      <div className="map-styles paper-panel">
        {(Object.keys(MAP_STYLES) as MapStyle[]).map((s) => (
          <button key={s} onClick={() => setStyle(s)} className={clsx('chip !py-1', style === s && 'on')}>
            {MAP_STYLES[s].name}
          </button>
        ))}
      </div>
      {!geo.length && !draft && (
        <div className="pointer-events-none absolute inset-0 z-[400] grid place-items-center">
          <div className="paper-panel rotate-[-1.5deg] rounded px-6 py-4 text-center">
            <div className="font-hand text-[26px] leading-none">No places pinned yet</div>
            <div className="mt-1 text-[13px] text-ink-soft">Search for a place above, paste a map link, or drop a pin.</div>
          </div>
        </div>
      )}
    </div>
  );
}
