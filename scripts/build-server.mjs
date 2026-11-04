// Bundles the server (TypeScript) into a single ESM file in dist/server.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Bundle dependencies (devDependencies only, e.g. @simplewebauthn); keep optional/native ones as runtime imports.
  external: ['vite', 'node-pty', '@xterm/headless', '@xterm/addon-serialize'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  sourcemap: true,
  logLevel: 'info',
});
