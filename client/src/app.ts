// The client app: store (data) -> world (canvas) -> UI (panels). Loaded by main.ts after the active language
// dictionary, because several modules call tr() upon loading.
import { loadAccess } from './net/access';
import { OfficeStore } from './net/store';
import { createWorld } from './world';
import { createUI } from './ui';
import { migrateLegacyKeys, safeLocalStorage } from './ui/prefs';
import { getLocale, tr } from '../../shared/i18n';

export function start(): void {
  // First of all: the world (desks) and the UI (preferences) read localStorage when created.
  migrateLegacyKeys(safeLocalStorage());

  // Chosen language (shared/i18n): screen readers and the browser spellchecker follow the lang attribute.
  document.documentElement.lang = getLocale();
  document.querySelector('meta[name="description"]')?.setAttribute(
    'content',
    tr('Pixel-art virtual office that shows, in real time, what your Claude Code agents are doing.'),
  );

  const store = new OfficeStore();
  const worldCanvas = document.getElementById('world') as HTMLCanvasElement;
  // "hold Alt" note (ui/hints.ts)
  worldCanvas.dataset.hint = tr('The office: click a character or room for details, drag to move, wheel to zoom');
  const uiRoot = document.getElementById('ui') as HTMLElement;
  const world = createWorld(worldCanvas, store);
  createUI(uiRoot, store, world);
  // What this page can do (local port or remote with login) arrives before the first snapshot (or times out in a
  // few seconds and keeps the previous rule).
  void loadAccess().finally(() => store.connect());
  // Reconnection (server restarted, phone back from lock): access may have changed, and login may have expired
  // (loadAccess navigates to the login screen).
  let opened = false;
  store.on('connection', (state) => {
    if (state === 'open') {
      if (opened) void loadAccess();
      opened = true;
    } else if (state === 'closed' && opened) void loadAccess();
  });

  // Facilitates debugging via the browser console.
  Object.assign(window, { habblaud: { store, world } });
}
