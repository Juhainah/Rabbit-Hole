import { RotateCcw } from 'lucide-react';
import { useEffect } from 'react';
import { useBoards } from '../store/boards';
import { useUi } from '../store/ui';

/** A small note at the bottom of the screen after destructive changes, with Undo. */
export function Toast() {
  const toast = useUi((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      if (useUi.getState().toast?.at === toast.at) useUi.getState().set({ toast: undefined });
    }, 5500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div key={toast.at} className="animate-rise fixed bottom-24 left-1/2 z-[60] -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-full bg-ink py-2 pr-2 pl-4 text-[13px] text-paper shadow-[0_12px_30px_-8px_rgba(0,0,0,.7)]">
        <span>{toast.text}</span>
        {toast.undo && (
          <button
            onClick={() => {
              const label = useBoards.getState().undo();
              useUi.getState().set({ toast: label ? { text: `Undone: ${label}`, at: Date.now() } : undefined });
            }}
            className="flex items-center gap-1 rounded-full bg-paper/15 px-3 py-1 font-semibold hover:bg-paper/25"
          >
            <RotateCcw size={13} /> Undo <kbd className="ml-1 text-[10.5px] opacity-60">Ctrl+Z</kbd>
          </button>
        )}
      </div>
    </div>
  );
}
