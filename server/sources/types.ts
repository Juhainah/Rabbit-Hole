import type { SourceItem } from '../../shared/types';

export interface SearchOpts {
  limit: number;
  signal?: AbortSignal;
}

export type SearchFn = (q: string, opts: SearchOpts) => Promise<SourceItem[]>;

/** First element of an array-or-scalar field (Internet Archive, Europeana, XML feeds…). */
export const one = <T>(v: T | T[] | undefined | null): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

export const arr = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export const host = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : undefined;
  } catch {
    return undefined;
  }
};
