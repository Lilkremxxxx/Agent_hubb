// Bundles the server (TypeScript) into dist/server/index.js plus one lazy chunk (@simplewebauthn, loaded on the first passkey ceremony).
import { build } from 'esbuild';

await build({
  entryPoints: ['server/index.ts'],
  outdir: 'dist/server',
  chunkNames: 'chunks/[name]-[hash]',
  splitting: true,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Bundle dependencies (devDependencies only, e.g. @simplewebauthn); keep optional/native ones as runtime imports.
  external: ['vite', 'node-pty', '@xterm/headless', '@xterm/addon-serialize'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  sourcemap: true,
  logLevel: 'info',
});

// Browser bundle of the remote sign-in/Passkeys pages. Run after `vite build` (which empties dist/client).
await build({
  entryPoints: ['client/src/remote/auth.ts'],
  outfile: 'dist/client/assets/remote/auth.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  minify: true,
  logLevel: 'info',
});
