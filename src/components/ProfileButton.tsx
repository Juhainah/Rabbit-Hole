import { LogOut, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { signOut, useAuth } from '../lib/auth';
import { useUi } from '../store/ui';
import { confirmAsk } from './Dialog';

/** Your account, top right: who you are signed in as, settings, and sign out. */
export function ProfileButton() {
  const { status, email, name, photo } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  // Sign-in is off on this copy of the app (running on your own computer): nothing to show.
  if (status === 'off' || status === 'loading') return null;
  const who = name || email || 'You';
  const initial = who.trim().slice(0, 1).toUpperCase();
  return (
    <div ref={box} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="grid size-9 place-items-center overflow-hidden rounded-full bg-[#c8322f] font-ui text-[14px] font-semibold text-white ring-2 ring-white/20 transition hover:ring-white/50"
        title={`Signed in as ${who}`}
        aria-label="Your account"
      >
        {photo ? <img src={photo} alt="" referrerPolicy="no-referrer" className="size-full object-cover" /> : initial}
      </button>
      {open && (
        <div className="paper-panel animate-rise absolute right-0 top-[46px] z-50 w-[260px] rounded-xl p-3 shadow-[0_18px_40px_-14px_rgba(0,0,0,.7)]">
          <div className="font-ui text-[11px] uppercase tracking-wider text-ink-soft">Signed in as</div>
          <div className="mt-0.5 truncate font-ui text-[14px] font-semibold text-ink" title={email}>
            {name || email}
          </div>
          {name && email && <div className="truncate font-ui text-[12px] text-ink-soft">{email}</div>}
          <div className="mt-1 font-ui text-[12px] text-ink-soft">Your boards are saved to this account and on this device.</div>
          <div className="my-2.5 h-px bg-ink/10" />
          <button
            onClick={() => {
              setOpen(false);
              useUi.getState().set({ settingsOpen: true });
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-ui text-[13.5px] text-ink hover:bg-paper-2"
          >
            <Settings2 size={15} /> Settings
          </button>
          <div className="flex gap-3 px-2 py-1 font-ui text-[12px] text-ink-soft">
            <a href="/terms.html" target="_blank" rel="noreferrer" className="hover:text-ink hover:underline">
              Terms
            </a>
            <a href="/privacy.html" target="_blank" rel="noreferrer" className="hover:text-ink hover:underline">
              Privacy
            </a>
          </div>
          <button
            onClick={async () => {
              setOpen(false);
              if (await confirmAsk('Sign out?', 'Your boards stay saved in your account. Sign back in on any device to see them.', { ok: 'Sign out' })) void signOut();
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-ui text-[13.5px] font-medium text-[#b3261e] hover:bg-[#b3261e]/10"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
