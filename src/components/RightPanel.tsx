import clsx from 'clsx';
import { BookOpen, ChevronsLeft, ChevronsRight, MessageCircle, Search, SquarePen } from 'lucide-react';
import { useSettings } from '../store/settings';
import { useUi, type RightTab } from '../store/ui';
import { ChatPanel } from './panels/ChatPanel';
import { Inspector } from './panels/Inspector';
import { ReaderPanel } from './panels/ReaderPanel';
import { SearchPanel } from './panels/SearchPanel';
import { ResizeHandle } from './ResizeHandle';

const TABS: { id: RightTab; label: string; color: string; icon: typeof Search; hint: string }[] = [
  { id: 'ai', label: 'Partner', color: '#dca83f', icon: MessageCircle, hint: 'Chat with your AI research partner' },
  { id: 'search', label: 'Archives', color: '#8ea67c', icon: Search, hint: 'Search 70 sources by hand' },
  { id: 'inspect', label: 'Card', color: '#c96d4b', icon: SquarePen, hint: 'Edit the selected card' },
  { id: 'read', label: 'Reader', color: '#7fa7b5', icon: BookOpen, hint: 'Read a source inside the app' },
];

/** A notebook with coloured divider tabs. Drag its left edge to resize. */
export function RightPanel({ available }: { available: string[] }) {
  const tab = useUi((s) => s.rightTab);
  const set = useUi((s) => s.set);
  const width = useSettings((s) => s.rightWidth);
  const setPrefs = useSettings((s) => s.set);
  return (
    <aside className="side-right relative z-20 flex shrink-0 flex-col bg-desk-2" style={{ width }}>
      <ResizeHandle
        edge="left"
        width={width}
        min={320}
        max={760}
        initial={420}
        onResize={(rightWidth) => setPrefs({ rightWidth })}
        onCollapse={() => set({ rightOpen: false })}
      />
      <div className="flex items-end gap-1 px-2 pt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => set({ rightTab: t.id })}
            title={t.hint}
            className={clsx(
              'relative flex flex-1 items-center justify-center gap-1.5 rounded-t-lg px-1.5 pt-2 pb-1.5 text-[13px] font-semibold transition',
              tab === t.id ? 'bg-paper text-ink' : 'bg-desk-3 text-paper/60 hover:-translate-y-0.5 hover:text-paper',
            )}
          >
            <span className="absolute inset-x-3 top-0 h-[3px] rounded-b" style={{ background: t.color }} />
            <t.icon size={14} className="shrink-0" />
            <span className="truncate">{t.label}</span>
          </button>
        ))}
        <button onClick={() => set({ rightOpen: false })} className="mb-1 rounded-md p-1.5 text-paper/50 hover:bg-white/5 hover:text-paper" title="Collapse panel">
          <ChevronsRight size={16} />
        </button>
      </div>
      <div className="paper-panel min-h-0 flex-1 overflow-hidden">
        <div className={clsx('h-full', tab !== 'ai' && 'hidden')}>
          <ChatPanel />
        </div>
        <div className={clsx('h-full', tab !== 'search' && 'hidden')}>
          <SearchPanel available={available} />
        </div>
        {tab === 'inspect' && (
          <div className="h-full overflow-x-hidden overflow-y-auto">
            <Inspector />
          </div>
        )}
        {tab === 'read' && (
          <div className="h-full overflow-x-hidden overflow-y-auto [overflow-wrap:anywhere]">
            <ReaderPanel />
          </div>
        )}
      </div>
    </aside>
  );
}

/** What the right panel shrinks to: one icon per tab. */
export function RightRail() {
  const tab = useUi((s) => s.rightTab);
  return (
    <aside className="side-rail relative z-20 flex w-11 shrink-0 flex-col items-center gap-1 border-l border-black/40 bg-desk-2 py-3">
      <button onClick={() => useUi.getState().set({ rightOpen: true })} className="rounded-lg p-2 text-paper/70 hover:bg-white/5 hover:text-paper" title="Show panel">
        <ChevronsLeft size={17} />
      </button>
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => useUi.getState().openTab(t.id)}
          className={clsx('rounded-lg p-2 hover:bg-white/5', tab === t.id ? 'text-paper' : 'text-paper/50 hover:text-paper')}
          title={`${t.label}: ${t.hint}`}
        >
          <t.icon size={17} />
        </button>
      ))}
    </aside>
  );
}
