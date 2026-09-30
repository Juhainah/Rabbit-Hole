import { X } from 'lucide-react';
import { useUi } from '../store/ui';

const STEPS = [
  {
    icon: '⛏',
    title: 'Dig',
    text: 'Type anything in the bar at the top (a mystery, a person, a place, or paste a link) and press DIG. Clues pin themselves to the board as each archive answers.',
  },
  {
    icon: '🕳️',
    title: 'Fall in',
    text: 'The purple rabbit-hole cards are leads. Press “fall in ↓” on one and a new case file opens, tied to the old one with string.',
  },
  {
    icon: '🔍',
    title: 'Look closer',
    text: 'Double-click any card to zoom in and edit it. Every card has Dig, Ask and Read buttons when you hover it.',
  },
  {
    icon: '🧵',
    title: 'Connect',
    text: 'Drag from one pin to another pin to tie your own string. Right-click a card or string for colours, labels and more.',
  },
  {
    icon: '💬',
    title: 'Ask your partner',
    text: 'The panel on the right is an AI research partner. It reads your board, checks the archives first, and suggests where to go next.',
  },
  {
    icon: '📋',
    title: 'One board per investigation',
    text: 'Start a fresh board with NEW BOARD (top bar or left sidebar). Switch boards from the name in the top bar.',
  },
];

const MOVES = [
  ['Move around', 'drag the empty cork, or two-finger scroll on a trackpad'],
  ['Zoom', 'pinch, Ctrl + scroll, the mouse wheel, or the + / − buttons'],
  ['See everything', 'the ⛶ button in the tool tray at the bottom'],
  ['Shortcuts', '/ dig bar · N sticky note · Ctrl+K search archives · Delete removes the selected card'],
];

export function HelpModal() {
  const open = useUi((s) => s.helpOpen);
  if (!open) return null;
  const close = (dig = false) => {
    try {
      localStorage.setItem('rh-seen-help', '1');
    } catch {
      /* private mode */
    }
    useUi.getState().set({ helpOpen: false });
    if (dig) setTimeout(() => document.getElementById('dig-input')?.focus(), 50);
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5 backdrop-blur-[2px]" onClick={() => close()}>
      <div onClick={(e) => e.stopPropagation()} className="paper-panel animate-rise relative max-h-[90vh] w-[min(820px,96vw)] overflow-y-auto rounded-xl px-8 pt-7 pb-7 rotate-[-0.3deg]">
        <button onClick={() => close()} className="absolute right-4 top-4 rounded-lg p-1.5 hover:bg-ink/10" aria-label="Close">
          <X size={18} />
        </button>
        <div className="font-type text-[11px] tracking-[0.2em] text-ink-soft">FIELD MANUAL</div>
        <h2 className="mt-1 font-serif text-[34px] font-bold leading-tight text-ink">
          How <span className="italic text-[#b3261e]">Rabbit Hole</span> works
        </h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <div key={s.title} className="flex gap-3 rounded-lg bg-[#fffdf7] p-3.5 shadow-[0_4px_12px_-8px_rgba(0,0,0,.4)]" style={{ rotate: `${(i % 2 ? 0.4 : -0.4).toFixed(1)}deg` }}>
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-paper-2 text-[20px]">{s.icon}</div>
              <div>
                <div className="font-hand text-[22px] font-bold leading-none text-ink">
                  {i + 1}. {s.title}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink/80">{s.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-lg border border-dashed border-ink/25 px-4 py-3">
          {MOVES.map(([k, v]) => (
            <div key={k} className="flex gap-3 py-0.5 text-[13px]">
              <span className="w-[120px] shrink-0 font-semibold text-ink">{k}</span>
              <span className="text-ink/75">{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          <button onClick={() => close(true)} className="btn-stamp px-6 py-2.5 text-[15px]">
            START DIGGING ↓
          </button>
        </div>
      </div>
    </div>
  );
}
