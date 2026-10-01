import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../lib/errors';
import { useBoards } from '../store/boards';
import { useUi } from '../store/ui';

/** If part of the page crashes, say so and offer a way back, instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error.message, `${error.stack ?? ''}\n--- component ---${info.componentStack ?? ''}`);
  }

  /** Clears whatever was open (a broken card's panel, a menu) and draws the page again. */
  retry(freshBoard = false) {
    useUi.getState().set({ selectedNodeId: undefined, selectedEdgeId: undefined, menu: undefined, caseFilesOpen: false, view: 'board' });
    if (freshBoard) useBoards.getState().createBoard();
    this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="desk grid h-full place-items-center p-6 text-center font-ui text-paper/85">
        <div className="max-w-[420px]">
          <div className="font-hand text-[34px] leading-none text-paper">Something on the page broke</div>
          <p className="mt-3 text-[14.5px] leading-relaxed">
            Your boards are safe. They're saved on this device and, when you're signed in, in your account. The problem has been logged.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button onClick={() => this.retry()} className="rounded-lg border border-white/20 px-4 py-2 text-[13px] hover:border-white/40">
              Try again
            </button>
            {/* If one board keeps breaking the page, a fresh one gets you back in; the old board stays in your list. */}
            <button onClick={() => this.retry(true)} className="rounded-lg border border-white/20 px-4 py-2 text-[13px] hover:border-white/40">
              Start a fresh board
            </button>
            <button onClick={() => window.location.reload()} className="btn-stamp px-4 py-2 text-[13px]">
              RELOAD
            </button>
          </div>
          <p className="mt-4 text-[12px] text-paper/45">{this.state.error.message}</p>
        </div>
      </div>
    );
  }
}
