import { sourceMeta } from '../../shared/sources';

export function Glyph({ id, className = '' }: { id: string; className?: string }) {
  const s = sourceMeta(id);
  const light = ['#d4d4d4', '#e8e1d0', '#e5e7eb', '#a3e635', '#f4f1e6', '#e5a54b', '#9ca3af', '#a3a3a3'].includes(s.color);
  return (
    <span className={`glyph ${className}`} style={{ background: s.color, color: light ? '#1f1a16' : '#fff', textShadow: light ? 'none' : undefined }} title={s.name}>
      {s.glyph}
    </span>
  );
}

export function SourceBadge({ id, className = '' }: { id?: string; className?: string }) {
  if (!id) return null;
  const s = sourceMeta(id);
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 overflow-hidden text-[10.5px] uppercase tracking-[0.1em] font-semibold text-ink-soft ${className}`}>
      <Glyph id={id} className="shrink-0" />
      <span className="min-w-0 truncate">{s.name}</span>
    </span>
  );
}
