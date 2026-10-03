// Is the Rabbit Hole server up and answering?
//   npm run check:health                                   (the one on this PC)
//   npm run check:health -- https://your-app.vercel.app    (the online one)
import 'dotenv/config';

const base = (process.argv[2] ?? `http://localhost:${process.env.API_PORT ?? 8787}`).replace(/\/+$/, '');

async function timed(path: string) {
  const t0 = Date.now();
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30000) });
  const body = await res.json().catch(() => null);
  return { status: res.status, ms: Date.now() - t0, body };
}

console.log(`\nChecking ${base}\n`);
try {
  const health = await timed('/api/health');
  if (health.status !== 200 || !health.body?.ok) throw new Error(`health check answered HTTP ${health.status}`);
  console.log(`  ✅ Server is up                answered in ${health.ms}ms`);
  console.log(`  ${health.body.ai ? '✅' : '❌'} AI brains                  ${health.body.ai ? 'at least one is configured' : 'none configured: add keys to .env'}`);
  console.log(`  ${health.body.signIn ? '🔐' : '🔓'} Sign-in                    ${health.body.signIn ? 'required (Supabase)' : 'off (fine on your own PC)'}`);

  const sources = await timed('/api/sources');
  if (sources.status === 200) console.log(`  ✅ Research sources           ${sources.body?.available?.length ?? 0} ready`);
  else if (sources.status === 401) console.log('  🔐 Research sources           need sign-in (working as intended)');
  else console.log(`  ❌ Research sources           HTTP ${sources.status}`);
  console.log('\n  For key-by-key limits, run: npm run check:keys\n');
  process.exit(0);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log(`  ❌ Can't reach the server: ${/fetch failed|ECONNREFUSED/i.test(msg) ? 'nothing is running there' : msg}`);
  console.log(base.includes('localhost') ? '     Start it with: npm run dev\n' : '     Check the deployment on vercel.com\n');
  process.exit(1);
}
