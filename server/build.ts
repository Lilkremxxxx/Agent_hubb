// Compiled client build identifier (dist/client): main bundle name, which changes on each
// `npm run build`. Included in snapshot so pages open prior to an update notice and reload.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE = /bundle\/(main-[\w-]+)\.js/;

/** Reads build id from compiled index.html (cached by modification date). */
export function createBuildReader(rootDir: string): () => string | undefined {
  const file = join(rootDir, 'dist', 'client', 'index.html');
  let mtime = -1;
  let id: string | undefined;
  return () => {
    try {
      const m = statSync(file).mtimeMs;
      if (m !== mtime) {
        mtime = m;
        id = BUNDLE.exec(readFileSync(file, 'utf8'))?.[1];
      }
    } catch {
      mtime = -1;
      id = undefined;
    }
    return id;
  };
}
