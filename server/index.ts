import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { app } from './app';
import { authProject } from './auth';
import { resolveProviders } from './llm';
import { availableSources } from './sources';

// Runs Rabbit Hole on your own machine. On Vercel, server/vercel.ts runs the same app instead.
const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
const HOST = process.env.API_HOST ?? (process.env.PORT ? '0.0.0.0' : '127.0.0.1');

// In production the same server hosts the built React app.
if (existsSync('dist/index.html')) {
  const indexHtml = readFileSync('dist/index.html', 'utf8');
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', (c) => c.html(indexHtml));
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  const brains = resolveProviders();
  console.log(`\n  🕳️  Rabbit Hole API on http://${HOST}:${info.port}`);
  console.log(`  🧠 AI chain: ${brains.map((b) => b.name).join(' → ') || 'none!'}`);
  console.log(`  📚 ${availableSources().length} research sources ready`);
  console.log(authProject() ? `  🔐 Sign-in required (Firebase project ${authProject()})` : '  🔓 Sign-in is off (no Firebase project set)');
  if (!process.env.CONTACT_EMAIL?.trim()) {
    console.log("  ⚠️  Set CONTACT_EMAIL in .env. Wikipedia and OpenStreetMap throttle apps that don't identify themselves.");
  }
  console.log();
});
