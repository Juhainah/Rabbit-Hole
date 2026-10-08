import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

// The app's own confirm / message / text-entry box, in place of the browser's grey popups.

interface Ask {
  title: string;
  body?: string;
  /** Text entry: the starting value (omit for a plain yes/no). */
  value?: string;
  ok?: string;
  cancel?: string | null;
  danger?: boolean;
  resolve: (answer: string | boolean | null) => void;
}

const useDialog = create<{ ask: Ask | null }>(() => ({ ask: null }));

const open = (a: Omit<Ask, 'resolve'>) =>
  new Promise<string | boolean | null>((resolve) => {
    useDialog.getState().ask?.resolve(null);
    useDialog.setState({ ask: { ...a, resolve } });
  });

/** Yes or no. Resolves true when confirmed. */
export const confirmAsk = (title: string, body?: string, opts: { ok?: string; danger?: boolean } = {}) =>
  open({ title, body, ok: opts.ok ?? 'OK', danger: opts.danger }).then((a) => a === true);

/** A message with one button. */
export const tell = (title: string, body?: string) => open({ title, body, ok: 'OK', cancel: null }).then(() => undefined);

/** Ask for a line of text. Resolves the text, or null if cancelled. */
export const askText = (title: string, value = '', ok = 'Save') => open({ title, value, ok }).then((a) => (typeof a === 'string' ? a : null));

export function Dialog() {
  const ask = useDialog((s) => s.ask);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const okBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!ask) return;
    setText(ask.value ?? '');
    setTimeout(() => (ask.value !== undefined ? input.current?.select() : okBtn.current?.focus()), 30);
  }, [ask]);
  if (!ask) return null;
  const close = (answer: string | boolean | null) => {
    useDialog.setState({ ask: null });
    ask.resolve(answer);
  };
  const confirm = () => close(ask.value !== undefined ? text.trim() : true);
  return (
    <div
      className="dialog-overlay fixed inset-0 z-[90] grid place-items-center bg-black/55 p-4 animate-[fade_.15s_ease-out]"
      onMouseDown={(e) => e.target === e.currentTarget && close(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && ask.value !== undefined) confirm();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={ask.title}
    >
      <div className="paper-panel animate-rise w-full max-w-[400px] rounded-xl p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,.8)]">
        <div className="font-hand text-[26px] leading-tight text-ink">{ask.title}</div>
        {ask.body && <p className="mt-2 font-ui text-[14px] leading-relaxed text-ink-soft">{ask.body}</p>}
        {ask.value !== undefined && (
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-3 w-full rounded-lg border border-ink/20 bg-white px-3 py-2 font-ui text-[15px] text-ink outline-none focus:border-ink/50"
          />
        )}
        <div className="mt-5 flex justify-end gap-2">
          {ask.cancel !== null && (
            <button onClick={() => close(null)} className="rounded-lg px-4 py-2 font-ui text-[14px] font-medium text-ink-soft hover:bg-ink/10 hover:text-ink">
              {ask.cancel ?? 'Cancel'}
            </button>
          )}
          <button
            ref={okBtn}
            onClick={confirm}
            className={`rounded-lg px-4 py-2 font-ui text-[14px] font-semibold text-white shadow ${ask.danger ? 'bg-[#b3261e] hover:bg-[#9a2019]' : 'bg-ink hover:bg-black'}`}
          >
            {ask.ok ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
