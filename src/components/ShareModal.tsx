import clsx from 'clsx';
import { Check, Cloud, CloudOff, Copy, ImageDown, Link2, LoaderCircle, Share2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { shareBoard, sharedLink, stopSharing, useCloud } from '../lib/cloud';
import { downloadBoardPicture } from '../lib/snapshot';
import { useBoards } from '../store/boards';
import { useUi } from '../store/ui';

const NOTES = {
  saving: 'Saving to your account…',
  saved: 'Saved to your account. Your boards follow you to any device you sign in on.',
  offline: "Can't reach your account right now. Your boards are safe on this device and will save when the connection is back.",
} as const;

/** Downloads the whole board as a PNG, ready to post. */
export function PictureButton({ className = 'chip' }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await downloadBoardPicture();
      useUi.getState().set({ toast: { text: 'Saved the board as a picture', at: Date.now() } });
    } catch (e) {
      useUi.getState().set({ toast: { text: e instanceof Error ? e.message : "Couldn't make the picture.", at: Date.now() } });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button onClick={() => void save()} disabled={busy} className={clsx(className, 'disabled:opacity-60')}>
      {busy ? <LoaderCircle size={14} className="animate-spin" /> : <ImageDown size={14} />} {busy ? 'Making the picture…' : 'Save as picture'}
    </button>
  );
}

/** Top-bar save indicator and the Share button. Both stay hidden when there's no account to save to. */
export function CloudStatus() {
  const state = useCloud((s) => s.state);
  const [open, setOpen] = useState(false);
  if (state === 'off' || state === 'unavailable') return null;
  const Icon = state === 'saving' ? LoaderCircle : state === 'offline' ? CloudOff : Cloud;
  return (
    <>
      <span className={clsx('grid place-items-center p-1', state === 'offline' ? 'text-[#e9a23b]' : 'text-paper/45')} title={NOTES[state]} aria-label={NOTES[state]}>
        <Icon size={16} className={state === 'saving' ? 'animate-spin' : undefined} />
      </span>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-[12.5px] text-paper/85 transition hover:border-white/35 hover:text-paper"
        title="Share this board with a link"
      >
        <Share2 size={14} />
        <span className="hidden lg:inline">Share</span>
      </button>
      {/* Drawn at the top of the page, so the top bar's styles (no wrapping, tight layout) don't leak in. */}
      {open && createPortal(<ShareModal onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function ShareModal({ onClose }: { onClose: () => void }) {
  const boardId = useBoards((s) => s.currentId);
  const name = useBoards((s) => s.boards[s.currentId]?.name ?? 'this board');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<'load' | 'share' | 'stop' | null>('load');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    sharedLink(boardId)
      .then((l) => live && setLink(l))
      .catch(() => undefined)
      .finally(() => live && setBusy(null));
    return () => {
      live = false;
    };
  }, [boardId]);

  const run = async (kind: 'share' | 'stop') => {
    setBusy(kind);
    setError('');
    try {
      if (kind === 'share') setLink(await shareBoard(boardId));
      else {
        await stopSharing(boardId);
        setLink(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      prompt('Copy this link', link);
    }
    setCopied(true);
    useUi.getState().set({ toast: { text: 'Link copied', at: Date.now() } });
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="paper-panel animate-rise relative w-[min(460px,100%)] rounded-xl px-6 pb-6 pt-5 font-ui text-ink">
        <button onClick={onClose} className="absolute right-3 top-3 rounded-lg p-1.5 hover:bg-ink/10" aria-label="Close">
          <X size={18} />
        </button>
        <div className="font-hand text-[28px] leading-none">Share this board</div>
        <p className="mt-2 pr-6 text-[13.5px] leading-relaxed text-ink/80">
          Anyone with the link can look around <b className="font-semibold">{name}</b> and make their own copy. They can't change yours, and your chat with the
          partner stays private.
        </p>

        {busy === 'load' ? (
          <div className="mt-4 flex items-center gap-2 text-[13px] text-ink-soft">
            <LoaderCircle size={15} className="animate-spin" /> Checking…
          </div>
        ) : link ? (
          <>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-ink/15 bg-[#fffdf7] p-1.5 pl-3">
              <Link2 size={15} className="shrink-0 text-ink-soft" />
              <input readOnly value={link} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" aria-label="Share link" />
              <button onClick={() => void copy()} className="btn-stamp flex shrink-0 items-center gap-1 px-3 py-1.5 text-[12px]">
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'COPIED' : 'COPY'}
              </button>
            </div>
            <p className="mt-2 text-[12px] leading-snug text-ink-soft">The link always shows the board as it is now, including changes you make later.</p>
            <button onClick={() => void run('stop')} disabled={!!busy} className="mt-3 text-[12.5px] font-medium text-[#b3261e] hover:underline disabled:opacity-50">
              {busy === 'stop' ? 'Turning the link off…' : 'Stop sharing'}
            </button>
          </>
        ) : (
          <button onClick={() => void run('share')} disabled={!!busy} className="btn-stamp mt-4 flex items-center gap-1.5 px-4 py-2 text-[13px] disabled:opacity-60">
            {busy === 'share' ? <LoaderCircle size={14} className="animate-spin" /> : <Link2 size={14} />} {busy === 'share' ? 'MAKING A LINK…' : 'CREATE A LINK'}
          </button>
        )}
        {error && <div className="mt-3 rounded-md bg-[#b3261e]/10 px-3 py-2 text-[12.5px] text-[#8c1d17]">{error}</div>}
        <div className="mt-4 flex items-center gap-3 border-t border-dashed border-ink/15 pt-3">
          <PictureButton />
          <span className="text-[12px] leading-snug text-ink-soft">The whole board as one image, for posting anywhere.</span>
        </div>
        <p className="mt-3 text-[11.5px] leading-snug text-ink-soft">
          Strings between cards are suggested by AI and can be wrong, especially about real people. Check the sources before you share a theory as fact.
        </p>
      </div>
    </div>
  );
}
