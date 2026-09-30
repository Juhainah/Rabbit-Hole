import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { Glyph } from '../SourceBadge';

const LEVEL = { info: 'text-ink/70', ok: 'text-[#2f6b3a]', warn: 'text-[#9a5b12]', err: 'text-[#b3261e]' };

/** A strip of typewriter paper that narrates each dig as sources report in. */
export function ActivityTicker() {
  const activity = useUi((s) => s.activity);
  const digging = useUi((s) => s.digging);
  const frame = useSettings((s) => s.frame);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const recent = activity.filter((a) => digging > 0 || now - a.at < 9000).slice(-7);
  if (!recent.length) return null;

  return (
    <div className={clsx('pointer-events-none absolute z-20 w-[340px]', frame ? 'left-[36px] top-[34px]' : 'left-[16px] top-[16px]')}>
      <div className="dig-strip rounded-sm px-3 py-2 rotate-[-0.8deg]">
        <div className="mb-1 flex items-center gap-2 label-caps text-ink-soft">
          {digging > 0 && <span className="size-1.5 rounded-full bg-[#c8322f] animate-pulse" />}
          field notes
        </div>
        {recent.map((a) => (
          <div key={a.id} className={clsx('ticker-line flex items-center gap-2 font-mono text-[11px] leading-[18px]', LEVEL[a.level])}>
            {a.source ? <Glyph id={a.source} className="!h-[15px] !min-w-[18px] !text-[8px]" /> : <span className="w-[18px] text-center">›</span>}
            <span className="truncate">{a.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
