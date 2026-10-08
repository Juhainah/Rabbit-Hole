import { lazy, Suspense, useEffect, useState } from 'react';
import { BoardView } from './components/board/BoardView';
import { LeftPanel, LeftRail } from './components/LeftPanel';
import { RightPanel, RightRail } from './components/RightPanel';
import { HelpModal } from './components/HelpModal';
import { SettingsModal } from './components/SettingsModal';
import { Logo, TopBar } from './components/TopBar';
import { api } from './lib/api';
import { useAuth } from './lib/auth';
import { SignIn } from './components/SignIn';
import { SharedView } from './components/SharedView';
import { CaseFiles } from './components/CaseFiles';
import { EmojiPicker } from './components/EmojiPicker';
import { MobileNav, useIsPhone } from './components/MobileNav';
import { Toast } from './components/Toast';
import { onUndoable } from './store/boards';

// The graph and map engines are heavy, so they load the first time you open them.
const GraphView = lazy(() => import('./components/views/GraphView').then((m) => ({ default: m.GraphView })));
const MapView = lazy(() => import('./components/views/MapView').then((m) => ({ default: m.MapView })));
const TimelineView = lazy(() => import('./components/views/TimelineView').then((m) => ({ default: m.TimelineView })));
import { addClue } from './lib/dig';
import { moveLayer } from './lib/layers';
import { useBoards } from './store/boards';
import { Dialog } from './components/Dialog';
import { useUi } from './store/ui';

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export default function App() {
  const signedIn = useAuth((s) => s.status === 'off' || s.status === 'signed-in');
  // A shared board's link opens for anyone, signed in or not.
  const [shared, setShared] = useState(() => new URLSearchParams(window.location.search).get('shared'));
  if (shared) {
    const leave = () => {
      window.history.replaceState(null, '', '/');
      setShared(null);
    };
    return <SharedView sid={shared} onLeave={leave} />;
  }
  // Nothing of the board loads until the visitor is through the front door.
  return signedIn ? <Desk /> : <SignIn />;
}

function Desk() {
  const hydrated = useBoards((s) => s.hydrated);
  const view = useUi((s) => s.view);
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const caseFilesOpen = useUi((s) => s.caseFilesOpen);
  const phone = useIsPhone();
  const [available, setAvailable] = useState<string[]>([]);

  useEffect(() => {
    api.sources().then(setAvailable).catch(() => undefined);
  }, []);

  // Opening the app lands on Case files, the home screen, once there is anything to come back to.
  useEffect(() => {
    if (!hydrated) return;
    const { boards } = useBoards.getState();
    if (Object.values(boards).some((b) => b.nodes.length > 0)) useUi.getState().set({ caseFilesOpen: true });
  }, [hydrated]);

  useEffect(() => {
    onUndoable((text) => useUi.getState().set({ toast: { text, at: Date.now(), undo: true } }));
  }, []);

  // The part of the screen you can see: a phone's keyboard covers the bottom, so pop-ups, sheets and
  // dialogs move up above it (--kb, --vvh, --vvt), and the bottom bar steps aside while you type.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const apply = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
      root.style.setProperty('--kb', `${kb}px`);
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      root.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`);
      // Android (resizing the page) shows it as a shorter screen; iPhone as a covered one.
      // Only a touch screen has an on-screen keyboard; a small desktop window must never hide the toolbar.
      const touch = window.matchMedia('(pointer: coarse)').matches;
      const typing = touch && (kb > 120 || (window.screen.height - vv.height > 260 && !!document.activeElement?.matches('input, textarea, [contenteditable]')));
      root.classList.toggle('kb-open', typing);
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    window.addEventListener('focusin', apply);
    window.addEventListener('focusout', () => setTimeout(apply, 120));
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      window.removeEventListener('focusin', apply);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !typing(e.target)) {
        e.preventDefault();
        const label = useBoards.getState().undo();
        useUi.getState().set({ toast: { text: label ? `Undone: ${label}` : 'Nothing to undo', at: Date.now() } });
        return;
      }
      // Esc peels back one layer: the emoji picker closes itself, then spotlight and case files.
      if (e.key === 'Escape' && !useUi.getState().emojiFor && !useUi.getState().tiePicker) useUi.getState().set({ menu: undefined, settingsOpen: false, spotlight: [], caseFilesOpen: false });
      if (typing(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('dig-input')?.focus();
      } else if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey) {
        addClue('note', {}, { near: useUi.getState().selectedNodeId });
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useUi.getState().openTab('search');
      } else if ((e.metaKey || e.ctrlKey) && (e.code === 'BracketRight' || e.code === 'BracketLeft') && useUi.getState().selectedNodeId) {
        // Layers, as in a design tool: Ctrl+] forward, Ctrl+[ backward; with Shift, all the way.
        e.preventDefault();
        const up = e.code === 'BracketRight';
        const said = moveLayer(useUi.getState().selectedNodeId!, up ? (e.shiftKey ? 'front' : 'forward') : e.shiftKey ? 'back' : 'backward');
        // A card sent down shows where it went once it is no longer lifted as the selected one.
        if (!up) useUi.getState().select();
        if (said) useUi.getState().set({ toast: { text: said, at: Date.now() } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!hydrated) {
    return (
      <div className="desk grid h-full place-items-center">
        <div className="animate-pulse">
          <Logo />
        </div>
      </div>
    );
  }

  return (
    <div className="desk flex h-full flex-col">
      <TopBar />
      {caseFilesOpen ? (
        <CaseFiles />
      ) : (
      <div className="flex min-h-0 flex-1">
        {leftOpen ? <LeftPanel /> : <LeftRail />}
        <main className="relative min-w-0 flex-1">
          {view === 'board' && <BoardView />}
          <Suspense fallback={<div className="grid h-full place-items-center font-hand text-[24px] text-paper/60">unfolding…</div>}>
            {view === 'graph' && <GraphView />}
            {view === 'map' && <MapView />}
            {view === 'timeline' && <TimelineView />}
          </Suspense>
        </main>
        {rightOpen ? <RightPanel available={available} /> : <RightRail />}
        {phone && (leftOpen || rightOpen) && <div className="phone-backdrop" onClick={() => useUi.getState().set({ leftOpen: false, rightOpen: false })} />}
      </div>
      )}
      {phone && <MobileNav />}
      <SettingsModal />
      <Dialog />
      <HelpModal />
      <Toast />
      <EmojiPicker />
    </div>
  );
}
