// OpenAI-compatible client with an ordered fallback chain across free providers.
// If a provider errors, rate-limits, times out or returns garbage, the next one is tried.
// If a provider has retired the configured model, a replacement is auto-picked from /models.

import type { ChatMessage, ProviderInfo } from '../shared/types';
import { errMsg, HttpError } from './http';
import { stripThinking } from './json';
import { presetById, PROVIDER_PRESETS } from './providers';

export interface ResolvedProvider {
  id: string;
  name: string;
  baseUrl: string;
  chatPath: string;
  apiKey?: string;
  model: string;
  hints: string[];
  usedModel?: string;
}

export interface LlmCall {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type OnProviderFail = (provider: ProviderInfo, error: string) => void;

const modelOverride = new Map<string, string>();

const env = (name: string) => process.env[name]?.trim() || undefined;
const envId = (id: string) => id.toUpperCase().replace(/-/g, '_');

/** The fallback chain, built only from the server's .env (LLM_ORDER, keys, <ID>_MODEL). */
export function resolveProviders(only?: string[]): ResolvedProvider[] {
  const order = [
    ...(env('LLM_ORDER')
      ?.split(',')
      .map((x) => x.trim())
      .filter(Boolean) ?? []),
    ...PROVIDER_PRESETS.map((p) => p.id),
  ].filter((id, i, all) => all.indexOf(id) === i);
  const out: ResolvedProvider[] = [];
  for (const id of order) {
    if (only && !only.includes(id)) continue;
    const preset = presetById(id);
    if (!preset) continue;
    if (id === 'ollama' && !/^(1|true|yes)$/i.test(env('OLLAMA_ENABLED') ?? '')) continue;
    const apiKey = preset.envKey ? env(preset.envKey) : undefined;
    if (!apiKey && !preset.keyless) continue;
    let baseUrl = env(`${envId(id)}_BASE_URL`) ?? preset.baseUrl;
    if (baseUrl.includes('{CLOUDFLARE_ACCOUNT_ID}')) {
      const account = env('CLOUDFLARE_ACCOUNT_ID');
      if (!account) continue;
      baseUrl = baseUrl.replace('{CLOUDFLARE_ACCOUNT_ID}', account);
    }
    let model = env(`${envId(id)}_MODEL`) ?? preset.model;
    // Money guard: OpenRouter bills for anything that isn't a ":free" model, so
    // no setting, typo or auto-recovery can ever point it at a paid one.
    if (id === 'openrouter' && !model.endsWith(':free')) {
      console.warn(`[ai] OPENROUTER_MODEL "${model}" is not a free model; using ${preset.model} instead.`);
      model = preset.model;
    }
    out.push({
      id,
      name: preset.name,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      chatPath: preset.chatPath ?? '/chat/completions',
      apiKey,
      model,
      hints: preset.modelHints,
    });
  }
  return out;
}

const info = (p: ResolvedProvider): ProviderInfo => ({ id: p.id, name: p.name, model: p.usedModel ?? p.model });

function headers(p: ResolvedProvider): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (p.apiKey) h.Authorization = `Bearer ${p.apiKey}`;
  if (p.id === 'openrouter') {
    h['HTTP-Referer'] = 'http://localhost:5173';
    h['X-Title'] = 'Rabbit Hole';
  }
  return h;
}

function shortBody(text: string): string {
  try {
    const j = JSON.parse(text);
    const m = j.error?.message ?? j.message ?? j.detail ?? j.error;
    if (typeof m === 'string') return m.slice(0, 160);
  } catch {
    /* not json */
  }
  return text.replace(/\s+/g, ' ').slice(0, 160);
}

export async function listModels(p: ResolvedProvider): Promise<string[]> {
  const res = await fetch(`${p.baseUrl}/models`, {
    headers: headers(p),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new HttpError(res.status, `models list: HTTP ${res.status}`);
  const j: any = await res.json();
  const arr: any[] = Array.isArray(j) ? j : (j.data ?? j.models ?? []);
  const ids = arr
    .map((m) => (typeof m === 'string' ? m : String(m.id ?? m.name ?? '')).replace(/^models\//, ''))
    .filter(Boolean)
    .filter((m) => !/embed|whisper|tts|guard|moderation|rerank|image|audio|transcri|ocr|imagen|veo|search/i.test(m));
  return p.id === 'openrouter' ? ids.filter((m) => m.endsWith(':free')) : ids;
}

/**
 * Replacement for a retired model. Only models matching the preset's known-free
 * hints are eligible: never "whatever is first in the list", which could be paid.
 */
function pickModel(p: ResolvedProvider, models: string[]): string | undefined {
  const pool = p.id === 'openrouter' ? models.filter((m) => m.endsWith(':free')) : models;
  for (const hint of p.hints) {
    const m = pool.find((x) => x.toLowerCase().includes(hint.toLowerCase()));
    if (m) return m;
  }
  return undefined;
}

function isModelError(e: unknown): boolean {
  if (!(e instanceof HttpError)) return false;
  // 404: no such model. 410: the model was retired (NVIDIA retires models on a schedule).
  if (e.status === 404 || e.status === 410) return true;
  return (e.status === 400 || e.status === 422) && /model/i.test(e.body) && /not|invalid|exist|found|decommission|deprecat|support|unknown/i.test(e.body);
}

async function withModelRecovery<T>(p: ResolvedProvider, fn: (model: string) => Promise<T>): Promise<T> {
  const key = `${p.id}|${p.model}`;
  const current = modelOverride.get(key) ?? p.model;
  p.usedModel = current;
  try {
    return await fn(current);
  } catch (e) {
    if (!isModelError(e)) throw e;
    const models = await listModels(p).catch(() => [] as string[]);
    const pick = pickModel(p, models.filter((m) => m !== current));
    if (!pick) throw e;
    modelOverride.set(key, pick);
    p.usedModel = pick;
    return fn(pick);
  }
}

/**
 * Reasoning models spend their output budget "thinking" first; a long think
 * can cut the actual answer short. Ask for brief thinking where it's supported.
 */
function extraParams(p: ResolvedProvider, model: string): Record<string, unknown> {
  if (p.id === 'groq' && /gpt-oss/.test(model)) return { reasoning_effort: 'low' };
  if (p.id === 'gemini' && /gemini-(2.5|3)/.test(model)) return { reasoning_effort: 'low' };
  return {};
}

async function postChat(p: ResolvedProvider, model: string, call: LlmCall, stream: boolean, signal: AbortSignal): Promise<Response> {
  const res = await fetch(p.baseUrl + p.chatPath, {
    method: 'POST',
    headers: headers(p),
    body: JSON.stringify({
      model,
      messages: call.messages,
      temperature: call.temperature ?? 0.7,
      max_tokens: call.maxTokens ?? 4000,
      stream,
      ...extraParams(p, model),
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(res.status, `HTTP ${res.status}: ${shortBody(text)}`, text);
  }
  return res;
}

function contentOf(j: any): string {
  const c = j?.choices?.[0]?.message?.content ?? j?.choices?.[0]?.text ?? j?.message?.content;
  if (Array.isArray(c)) return c.map((part: any) => (typeof part === 'string' ? part : (part?.text ?? ''))).join('');
  return typeof c === 'string' ? c : '';
}

async function completeOnce(p: ResolvedProvider, model: string, call: LlmCall): Promise<string> {
  const signals = [AbortSignal.timeout(call.timeoutMs ?? 90000)];
  if (call.signal) signals.push(call.signal);
  const res = await postChat(p, model, call, false, AbortSignal.any(signals));
  const text = await res.text();
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('non-JSON reply');
  }
  if (j.error) throw new Error(shortBody(JSON.stringify(j)));
  return stripThinking(contentOf(j)).trim();
}

export async function completeWithFallback<T>(
  providers: ResolvedProvider[],
  call: LlmCall,
  validate: (text: string) => T,
  onFail?: OnProviderFail,
): Promise<{ value: T; provider: ProviderInfo }> {
  if (!providers.length) throw new Error('No AI providers are enabled. Open Settings → AI and enable one.');
  const errors: string[] = [];
  for (const p of providers) {
    try {
      const text = await withModelRecovery(p, (model) => completeOnce(p, model, call));
      if (!text) throw new Error('empty reply');
      return { value: validate(text), provider: info(p) };
    } catch (e) {
      if (call.signal?.aborted) throw e;
      const m = errMsg(e);
      errors.push(`${p.name}: ${m}`);
      onFail?.(info(p), m);
    }
  }
  throw new Error(`Every AI provider failed.\n${errors.join('\n')}`);
}

async function* readStream(res: Response, idleMs: number): AsyncGenerator<string> {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('event-stream')) {
    const j = await res.json().catch(() => null);
    const c = contentOf(j);
    if (c) yield c;
    return;
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error('stream stalled')), idleMs);
    });
    const { value, done } = await Promise.race([reader.read(), idle]).finally(() => clearTimeout(timer));
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      let j: any;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.error) throw new Error(shortBody(JSON.stringify(j)));
      const d = j.choices?.[0]?.delta?.content;
      if (typeof d === 'string' && d) yield d;
      else if (Array.isArray(d)) yield d.map((x: any) => x?.text ?? '').join('');
    }
  }
}

export type StreamPiece = { type: 'meta'; provider: ProviderInfo } | { type: 'delta'; text: string };

export async function* streamWithFallback(
  providers: ResolvedProvider[],
  call: LlmCall,
  onFail?: OnProviderFail,
): AsyncGenerator<StreamPiece> {
  if (!providers.length) throw new Error('No AI providers are enabled. Open Settings → AI and enable one.');
  const errors: string[] = [];
  for (const p of providers) {
    let started = false;
    const ctrl = new AbortController();
    const firstByte = setTimeout(() => ctrl.abort(new Error('no response in 45s')), 45000);
    const signal = call.signal ? AbortSignal.any([call.signal, ctrl.signal]) : ctrl.signal;
    try {
      const res = await withModelRecovery(p, (model) => postChat(p, model, call, true, signal));
      for await (const text of readStream(res, 45000)) {
        if (!started) {
          started = true;
          clearTimeout(firstByte);
          yield { type: 'meta', provider: info(p) };
        }
        yield { type: 'delta', text };
      }
      if (started) return;
      throw new Error('empty reply');
    } catch (e) {
      if (call.signal?.aborted) throw e;
      if (started) throw new Error(`${p.name} stopped mid-answer: ${errMsg(e)}`);
      const m = errMsg(e);
      errors.push(`${p.name}: ${m}`);
      onFail?.(info(p), m);
    } finally {
      clearTimeout(firstByte);
    }
  }
  throw new Error(`Every AI provider failed.\n${errors.join('\n')}`);
}

/**
 * Used by `npm run check:ai` and `check:keys` to verify each configured provider.
 * Also returns the rate-limit headers the provider sent, when it sends any.
 */
export async function testProvider(p: ResolvedProvider) {
  const t0 = Date.now();
  const limits: Record<string, string> = {};
  try {
    const reply = await withModelRecovery(p, async (model) => {
      const res = await postChat(p, model, { messages: [{ role: 'user', content: 'Reply with exactly one word: pong' }], maxTokens: 400, temperature: 0 }, false, AbortSignal.timeout(45000));
      res.headers.forEach((v, k) => {
        if (/rate-?limit|quota/i.test(k)) limits[k.toLowerCase()] = v;
      });
      const j: any = await res.json().catch(() => {
        throw new Error('non-JSON reply');
      });
      if (j.error) throw new Error(shortBody(JSON.stringify(j)));
      return stripThinking(contentOf(j)).trim();
    });
    return { ok: true, ms: Date.now() - t0, reply: reply.slice(0, 60), model: p.usedModel ?? p.model, limits };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: errMsg(e), model: p.usedModel ?? p.model, limits };
  }
}

/** "requests 14,398/14,400 · tokens 7,990/8,000" from whatever rate-limit headers a provider sends. */
export function describeLimits(h: Record<string, string>, providerId?: string): string {
  const n = (v?: string) => (v && !Number.isNaN(Number(v)) ? Number(v).toLocaleString('en-US') : v);
  const pair = (what: string, remaining?: string, limit?: string, period = '') => (remaining && limit ? `${what} ${n(remaining)}/${n(limit)} left${period && ` ${period}`}` : '');
  // Groq counts requests per day and tokens per minute.
  const period = providerId === 'groq' ? { requests: 'today', tokens: 'this minute' } : { requests: '', tokens: '' };
  return [
    pair('requests', h['x-ratelimit-remaining-requests'], h['x-ratelimit-limit-requests'], period.requests),
    pair('tokens', h['x-ratelimit-remaining-tokens'], h['x-ratelimit-limit-tokens'], period.tokens),
    pair('requests', h['x-ratelimit-remaining'], h['x-ratelimit-limit']),
  ]
    .filter(Boolean)
    .join(' · ');
}
