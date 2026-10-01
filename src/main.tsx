import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import './lib/errors';
import { installTextures } from './lib/textures';
import { useBoards } from './store/boards';
import { useSettings } from './store/settings';
import { useUi } from './store/ui';

installTextures();

// Dev-only handle for automated checks (never in production builds).
if (import.meta.env.DEV) Object.assign(window, { __rh: { useBoards, useUi, useSettings } });

// Archive thumbnails sometimes 404. Hide the broken image rather than show a torn icon.
window.addEventListener(
  'error',
  (e) => {
    const el = e.target;
    if (el instanceof HTMLImageElement && el.closest('.clue, .photo-clip, aside')) el.style.display = 'none';
  },
  true,
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
