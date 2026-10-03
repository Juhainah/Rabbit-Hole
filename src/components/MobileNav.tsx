import clsx from 'clsx';
import { CalendarRange, FolderOpen, LayoutDashboard, Map as MapIcon, MessageCircle, Network } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useUi, type View } from '../store/ui';

const PHONE = '(max-width: 767px)';

/** True on phone-sized screens, where the side panels become a drawer and a bottom sheet. */
export function useIsPhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

const VIEWS: { id: View; label: string; icon: typeof Network }[] = [
  { id: 'board', label: 'Board', icon: LayoutDashboard },
  { id: 'graph', label: 'Web', icon: Network },
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'timeline', label: 'Timeline', icon: CalendarRange },
];

/** The phone's bottom bar: your boards, the four views, and the research partner. */
export function MobileNav() {
  const view = useUi((s) => s.view);
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const caseFilesOpen = useUi((s) => s.caseFilesOpen);
  const set = useUi((s) => s.set);
  const item = 'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5 text-[10.5px] font-medium';
  return (
    <nav className="mobile-nav" aria-label="Main">
      <button className={clsx(item, caseFilesOpen ? 'text-[#f2c14e]' : 'text-paper/60')} onClick={() => set({ caseFilesOpen: true, leftOpen: false, rightOpen: false })}>
        <FolderOpen size={19} />
        Cases
      </button>
      {VIEWS.map((v) => (
        <button
          key={v.id}
          className={clsx(item, view === v.id && !leftOpen && !rightOpen && !caseFilesOpen ? 'text-[#f2c14e]' : 'text-paper/60')}
          onClick={() => set({ view: v.id, leftOpen: false, rightOpen: false, caseFilesOpen: false })}
        >
          <v.icon size={19} />
          {v.label}
        </button>
      ))}
      <button className={clsx(item, rightOpen ? 'text-paper' : 'text-paper/60')} onClick={() => set({ rightOpen: !rightOpen, leftOpen: false, caseFilesOpen: false })}>
        <MessageCircle size={19} />
        Partner
      </button>
    </nav>
  );
}
