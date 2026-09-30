import clsx from 'clsx';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { MAP_STYLES, nodeColor, prettyDate, type MapStyle } from '../../lib/utils';
import { useCurrentBoard } from '../../store/boards';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import type { ClueNode } from '../../types';

const icon = (color: string) =>
  L.divIcon({ className: '', html: `<div class="rh-pin" style="background:${color}"></div>`, iconSize: [22, 22], iconAnchor: [11, 24], popupAnchor: [0, -22] });

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 7);
    else map.fitBounds(L.latLngBounds(points), { padding: [70, 70], maxZoom: 9 });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Every clue with coordinates, on a real map, with strings between connected places. */
export function MapView() {
  const board = useCurrentBoard();
  const theme = useSettings((s) => s.theme);
  const dark = theme === 'void' || theme === 'chalk' || theme === 'blueprint';
  const [style, setStyle] = useState<MapStyle>(dark ? 'night' : 'explorer');
  const tiles = MAP_STYLES[style];
  const geo = useMemo(() => board.nodes.filter((n): n is ClueNode & { data: { lat: number; lon: number } } => n.data.lat != null && n.data.lon != null), [board.nodes]);
  const byId = useMemo(() => new Map(geo.map((n) => [n.id, n])), [geo]);
  const lines = board.edges
    .map((e) => [byId.get(e.source), byId.get(e.target)] as const)
    .filter(([a, b]) => a && b)
    .map(([a, b]) => [[a!.data.lat, a!.data.lon], [b!.data.lat, b!.data.lon]] as [number, number][]);

  return (
    <div className="relative h-full w-full">
      <MapContainer center={[30, 10]} zoom={2} className="h-full w-full" worldCopyJump>
        <TileLayer key={style} url={tiles.url} attribution={tiles.attribution} maxZoom={tiles.maxZoom} subdomains="abc" />
        <Fit points={geo.map((n) => [n.data.lat, n.data.lon])} />
        {lines.map((l, i) => (
          <Polyline key={i} positions={l} pathOptions={{ color: '#d23a36', weight: 2.2, dashArray: '6 6', opacity: 0.85 }} />
        ))}
        {geo.map((n) => (
          <Marker key={n.id} position={[n.data.lat, n.data.lon]} icon={icon(nodeColor(n))}>
            <Popup>
              <div className="w-[220px]">
                {n.data.image && <img src={n.data.image} alt="" className="mb-2 h-[110px] w-full object-cover" />}
                <div className="font-type text-[15px] leading-tight">{n.data.title}</div>
                {n.data.date && <div className="font-hand text-[16px] text-[#b3261e]">{prettyDate(n.data.date)}</div>}
                {n.data.text && <p className="!my-1.5 text-[12px] leading-snug line-clamp-4">{n.data.text}</p>}
                <div className="mt-2 flex gap-1.5">
                  <button className="chip" onClick={() => useUi.getState().focusNodes([n.id])}>
                    Show on board
                  </button>
                  <button className="chip" onClick={() => { useUi.getState().select(n.id); useUi.getState().openTab('inspect'); }}>
                    Inspect
                  </button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="paper-panel absolute right-4 top-4 z-[500] flex gap-1 rounded-xl p-1.5">
        {(Object.keys(MAP_STYLES) as MapStyle[]).map((s) => (
          <button key={s} onClick={() => setStyle(s)} className={clsx('chip !py-1', style === s && 'on')}>
            {MAP_STYLES[s].name}
          </button>
        ))}
      </div>
      {!geo.length && (
        <div className="pointer-events-none absolute inset-0 z-[500] grid place-items-center">
          <div className="paper-panel rotate-[-1.5deg] rounded px-6 py-4 text-center">
            <div className="font-hand text-[26px] leading-none">No places pinned yet</div>
            <div className="mt-1 text-[13px] text-ink-soft">Dig into something with a location and it will show up here.</div>
          </div>
        </div>
      )}
    </div>
  );
}
