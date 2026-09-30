// Packages Rabbit Hole for Vercel (Build Output API), run by `npm run vercel-build`:
//   .vercel/output/static/           the built site (from `vite build`)
//   .vercel/output/functions/api.func the whole API as one Node function
// Our own code is bundled into one file; npm packages are traced and copied beside it.
import { nodeFileTrace } from '@vercel/nft';
import { build } from 'esbuild';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT = '.vercel/output';
const FUNC = `${OUT}/functions/api.func`;
const ENTRY = 'build/api.mjs';

if (!existsSync('dist/index.html')) throw new Error('Run `vite build` first (dist/ is missing).');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(FUNC, { recursive: true });

// 1. The site.
cpSync('dist', `${OUT}/static`, { recursive: true });

// 2. The API: server/vercel.ts and everything it imports from our code, in one file.
await build({
  entryPoints: ['server/vercel.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  outfile: ENTRY,
  logLevel: 'warning',
});

// 3. The npm packages it needs, found by tracing the bundle's imports.
const { fileList } = await nodeFileTrace([ENTRY], { base: process.cwd() });
let copied = 0;
for (const raw of fileList) {
  const file = raw.replace(/\\/g, '/');
  if (!file.startsWith('node_modules/')) continue;
  const to = join(FUNC, file);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(file, to);
  copied++;
}
copyFileSync(ENTRY, `${FUNC}/index.mjs`);

writeFileSync(
  `${FUNC}/.vc-config.json`,
  JSON.stringify(
    {
      runtime: 'nodejs24.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      // A dig streams for a minute or two; the free plan allows up to five.
      maxDuration: 300,
      memory: 1024,
    },
    null,
    2,
  ),
);

// 4. Routing: /api/* to the function, files as they are, everything else to the app.
writeFileSync(
  `${OUT}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '^/api/(.*)$', dest: '/api?__path=$1' },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log(`Vercel output ready: site + API function (${copied} package files traced).`);
