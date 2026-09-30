// Tests every AI provider configured in .env:  npm run check:ai
import 'dotenv/config';
import { describeLimits, resolveProviders, testProvider } from '../server/llm';
import { PROVIDER_PRESETS } from '../server/providers';

const chain = resolveProviders();
const configured = new Set(chain.map((p) => p.id));
console.log('\nAI fallback chain (from .env):\n');
for (const p of chain) {
  const r = await testProvider(p);
  const limits = r.ok ? describeLimits(r.limits, p.id) : '';
  const status = r.ok ? `✅ ${r.ms}ms  "${r.reply}"${limits ? `  ${limits}` : ''}` : `❌ ${r.error}`;
  console.log(`  ${p.name.padEnd(26)} ${String(r.model).padEnd(40)} ${status}`);
}
const missing = PROVIDER_PRESETS.filter((p) => !configured.has(p.id) && !p.keyless);
if (missing.length) {
  console.log('\nNot configured (add a free key to .env to enable):');
  for (const p of missing) console.log(`  ${p.name.padEnd(26)} ${p.envKey}  →  ${p.keyUrl}`);
}
console.log();
process.exit(0);
