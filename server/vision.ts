import type { SourceItem } from '../shared/types';
import { BROWSER_UA, sleep } from './http';
import { parseJsonLoose } from './json';

// Before a picture goes on the board, an AI that can see looks at it: what does it actually show,
// and is that what this investigation is about? Archive pictures often arrive with nothing but a
// file number for a name ("788445.1"), so their titles can't tell a war photo from anything else.

export interface Seen {
  fits: boolean;
  shows: string;
}

const MAX_BYTES = 3_000_000;
const TYPES = /^image\/(jpeg|png|webp|gif)/i;

/** The picture's bytes as a data URL (Wayback copies are fetched raw, without the archive's toolbar). */
async function asDataUrl(src: string, signal: AbortSignal): Promise<string | null> {
  const url = src.replace(/\/web\/(\d{14})(im_|id_)?\//, '/web/$1im_/');
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'image/*' }, signal, redirect: 'follow' }).catch(() => null);
  if (!res?.ok) return null;
  const type = res.headers.get('content-type') ?? '';
  if (!TYPES.test(type) || Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES || buf.byteLength < 200) return null;
  return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
}

/** Free models that can see pictures, best first. Each has its own daily allowance. */
function seers(): { url: string; key: string; model: string }[] {
  const out: { url: string; key: string; model: string }[] = [];
  const gemini = process.env.GEMINI_API_KEY?.trim();
  if (gemini) for (const model of ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash']) out.push({ url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: gemini, model });
  const groq = process.env.GROQ_API_KEY?.trim();
  if (groq) out.push({ url: 'https://api.groq.com/openai/v1/chat/completions', key: groq, model: 'meta-llama/llama-4-scout-17b-16e-instruct' });
  return out;
}

/**
 * A picture whose name says nothing about what it shows: an archive file number ("788445.1"),
 * a camera name ("IMG_2041"). Its title can't be checked, so its pixels must be.
 */
export function needsLooking(it: SourceItem): boolean {
  if (it.source === 'wayback' || it.id.startsWith('web:img:')) return true;
  const name = it.title.replace(/\s*\(.*\)\s*$/, '').replace(/\.[a-z]{3,4}$/i, '');
  return !/[a-z]{4,}/i.test(name) || /^(img|dsc|image|photo|scan|file)[\s_-]*\d+$/i.test(name.trim());
}

/** Recently turned away (daily cap, busy): skip for a while. */
const resting = new Map<string, number>();

async function ask(images: string[], about: string, signal: AbortSignal): Promise<Seen[] | null> {
  const prompt = `The user is investigating: "${about}".
For each numbered picture, say in at most 12 words what it actually shows, and whether it fits the investigation: it shows the subject, or something the investigation is about. A picture of something else (unrelated people, adult content, ads, logos, blank or broken images) does not fit.
Output ONLY JSON: {"pictures": [{"n": 1, "shows": "…", "fits": true}]}`;
  const content = [{ type: 'text', text: prompt }, ...images.flatMap((url, i) => [{ type: 'text', text: `Picture ${i + 1}:` }, { type: 'image_url', image_url: { url } }])];
  for (const s of seers()) {
    if ((resting.get(s.model) ?? 0) > Date.now()) continue;
    const res = await fetch(s.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.key}` },
      body: JSON.stringify({ model: s.model, messages: [{ role: 'user', content }], temperature: 0.1, max_tokens: 700 }),
      signal,
    }).catch(() => null);
    if (!res) continue;
    if (!res.ok) {
      resting.set(s.model, Date.now() + (res.status === 429 ? 10 * 60_000 : 60 * 60_000));
      continue;
    }
    const j = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
    try {
      const parsed = parseJsonLoose<{ pictures?: { n?: number; shows?: string; fits?: boolean }[] }>(j?.choices?.[0]?.message?.content ?? '');
      const out: Seen[] = images.map(() => ({ fits: false, shows: '' }));
      for (const p of parsed.pictures ?? []) {
        const i = Number(p.n) - 1;
        if (out[i]) out[i] = { fits: p.fits === true, shows: String(p.shows ?? '').trim().slice(0, 120) };
      }
      return out;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Looks at each picture and keeps the ones that show what the investigation is about, with a
 * caption of what they show. Pictures it could not look at are returned unchanged when `keepUnseen`
 * (the usual checks already passed them), or dropped otherwise. Never takes longer than `ms`.
 */
export async function vetPictures(items: SourceItem[], about: string, signal: AbortSignal, opts: { keepUnseen?: (it: SourceItem) => boolean; ms?: number } = {}): Promise<SourceItem[]> {
  if (!items.length || !seers().length) return items.filter((it) => opts.keepUnseen?.(it) ?? true);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(opts.ms ?? 14_000)]);
  const work = (async () => {
    const data = await Promise.all(items.map((it) => (it.image ? asDataUrl(it.image, deadline).catch(() => null) : Promise.resolve(null))));
    const seen = new Map<string, Seen>();
    const ready = items.map((it, i) => ({ it, url: data[i] })).filter((x): x is { it: SourceItem; url: string } => !!x.url);
    for (let i = 0; i < ready.length; i += 6) {
      const batch = ready.slice(i, i + 6);
      const answers = await ask(
        batch.map((b) => b.url),
        about,
        deadline,
      ).catch(() => null);
      if (!answers) break;
      batch.forEach((b, k) => seen.set(b.it.id, answers[k]));
    }
    return seen;
  })();
  const seen = await Promise.race([work, sleep(opts.ms ?? 14_000).then(() => new Map<string, Seen>())]);
  return items.flatMap((it) => {
    const s = seen.get(it.id);
    if (!s) return opts.keepUnseen?.(it) ?? true ? [it] : [];
    if (!s.fits) return [];
    return [{ ...it, snippet: s.shows ? `${s.shows}${it.snippet ? ` · ${it.snippet}` : ''}` : it.snippet }];
  });
}
