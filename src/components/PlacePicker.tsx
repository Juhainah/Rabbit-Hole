import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { isMapLink, isShortMapLink, parseCoords } from '../../shared/maplink';
import { api } from '../lib/api';
import type { FoundPlace } from '../lib/places';

/**
 * Type a place, an address, coordinates, or paste a map link (Google, Apple, OpenStreetMap): suggestions
 * from the map appear as you type, and picking one hands it back with its coordinates.
 */
export function PlacePicker({ onPick, onRaw, rawLabel, placeholder, autoFocus, className }: { onPick: (p: FoundPlace) => void; /** Use the typed name as it is (a place no map has). */ onRaw?: (text: string) => void; rawLabel?: string; placeholder?: string; autoFocus?: boolean; className?: string }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<FoundPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setList([]);
      setNote('');
      setBusy(false);
      return;
    }
    const ctl = new AbortController();
    // A link or coordinates is looked up at once; a name waits until you pause typing.
    const quick = isMapLink(t) || isShortMapLink(t) || !!parseCoords(t);
    const timer = setTimeout(
      () => {
        setBusy(true);
        api
          .places(t, undefined, ctl.signal)
          .then((r) => {
            setList(r.places);
            setActive(0);
            setNote(r.places.length ? '' : r.error || 'Nothing on the map by that name. Try adding the town or country.');
          })
          .catch((e) => !ctl.signal.aborted && setNote(e instanceof Error ? e.message : String(e)))
          .finally(() => !ctl.signal.aborted && setBusy(false));
      },
      quick ? 0 : 400,
    );
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q]);

  const pick = (p: FoundPlace) => {
    onPick(p);
    setQ('');
    setList([]);
    setNote('');
  };

  return (
    <div className={clsx('place-picker nodrag nowheel', className)} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, list.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (list[active]) pick(list[active]);
          } else if (e.key === 'Escape') setQ('');
        }}
        placeholder={placeholder ?? 'A place, an address, a map link or coordinates'}
        className="add-input"
        aria-label="Find a place"
      />
      {(busy || note || list.length > 0 || (onRaw && q.trim().length > 1)) && (
        <div className="place-suggest" role="listbox">
          {busy && !list.length && <div className="place-note">Looking on the map…</div>}
          {list.map((p, i) => (
            <button
              key={`${p.lat},${p.lon},${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className={clsx('place-option', i === active && 'on')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
            >
              <span className="place-name">📍 {p.name}</span>
              {p.full && p.full !== p.name && <span className="place-full">{p.full}</span>}
            </button>
          ))}
          {note && !busy && <div className="place-note">{note}</div>}
          {onRaw && q.trim().length > 1 && !busy && (
            <button type="button" className="place-option" onMouseDown={(e) => e.preventDefault()} onClick={() => { onRaw(q.trim()); setQ(''); setList([]); setNote(''); }}>
              <span className="place-name">✎ {rawLabel ?? 'Use the name as typed'}: “{q.trim()}”</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
