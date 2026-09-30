import { Loader2 } from 'lucide-react';
import { AUTH_PROVIDERS, signIn, useAuth } from '../lib/auth';

// Google's own "G", as their sign-in button guidelines ask for.
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

// GitHub's mark, for its sign-in button.
function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="#1f1f1f">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** The front door: a case folder on the desk, opened by signing in. */
export function SignIn() {
  const { status, error, busy } = useAuth();
  const loading = status === 'loading';
  return (
    <div className="desk grid h-full place-items-center overflow-y-auto px-4 py-10">
      <div className="case-folder animate-rise w-[min(440px,100%)]">
        <div className="case-folder-tab">Case files</div>
        <div className="case-folder-body">
          <div className="paper-panel relative rotate-[-1.2deg] rounded-sm px-7 pt-9 pb-7">
            <div className="washi absolute -top-3 left-1/2 h-6 w-28 -translate-x-1/2 rotate-[2deg]" />
            <div className="stamp absolute top-5 right-5 text-[12px] text-string">Confidential</div>
            <div className="font-hand text-[44px] leading-none font-bold text-ink">Rabbit Hole</div>
            <p className="mt-3 font-type text-[15px] leading-snug text-ink-soft">Sign in to open your case files and start digging.</p>
            <div className="mt-6 grid gap-2.5">
              {AUTH_PROVIDERS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void signIn(p)}
                  disabled={loading || !!busy}
                  className="flex w-full items-center justify-center gap-3 rounded-lg border border-ink/20 bg-white px-4 py-3 font-ui text-[15px] font-semibold text-[#1f1f1f] shadow-sm transition hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-string disabled:cursor-wait disabled:opacity-70"
                >
                  {loading || busy === p ? <Loader2 size={18} className="animate-spin" /> : p === 'google' ? <GoogleG /> : <GitHubMark />}
                  {loading ? 'Opening the file…' : busy === p ? `Opening ${p === 'google' ? 'Google' : 'GitHub'}…` : `Continue with ${p === 'google' ? 'Google' : 'GitHub'}`}
                </button>
              ))}
            </div>
            {error && (
              <p role="alert" className="mt-3 font-ui text-[13.5px] leading-snug text-string">
                {error}
              </p>
            )}
            <div className="mt-6 space-y-1.5 border-t border-dashed border-ink/20 pt-4 font-ui text-[13px] leading-relaxed text-ink-soft">
              <p>The research partner runs on free services. Signing in keeps them from being overused.</p>
              <p>Your boards are saved in this browser.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
