import clsx from 'clsx';
import { Mic, Square } from 'lucide-react';
import { useRef, useState } from 'react';
import { useUi } from '../../store/ui';

// The browser's own speech recognition (Edge and Chrome): free, no key.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Recognizer = any;
const Recognition: (new () => Recognizer) | undefined =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

/** Talk instead of typing: words appear in the box as you speak; press Enter to send. */
export function MicButton({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognizer>(null);
  if (!Recognition) return null;

  const start = () => {
    const r = new Recognition();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.continuous = true;
    const before = value.trim() ? `${value.trimEnd()} ` : '';
    r.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      let said = '';
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      onChange(before + said.trimStart());
    };
    r.onerror = (e: { error: string }) => {
      setListening(false);
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      const text = e.error === 'not-allowed' ? 'The microphone is blocked. Allow it from the icon in the address bar, then try again.' : "Couldn't hear that. Try again.";
      useUi.getState().set({ toast: { text, at: Date.now() } });
    };
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };

  return (
    <button
      type="button"
      onClick={() => (listening ? rec.current?.stop() : start())}
      className={clsx('mic-btn grid size-[42px] shrink-0 place-items-center rounded-lg border transition', listening ? 'on border-[#b3261e] bg-[#b3261e] text-white' : 'border-ink/15 bg-white text-ink-soft hover:text-ink')}
      title={listening ? 'Stop listening' : 'Speak your question'}
      aria-label={listening ? 'Stop listening' : 'Speak your question'}
      aria-pressed={listening}
    >
      {listening ? <Square size={14} fill="currentColor" /> : <Mic size={18} />}
    </button>
  );
}
