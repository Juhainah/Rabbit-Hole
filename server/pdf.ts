import { BROWSER_UA } from './http';

// PDFs (declassified files, court records, papers) as readable text. pdf.js runs here in
// Node without a worker thread: its worker module is loaded into this process instead.

let ready: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;
function pdfjs() {
  ready ??= (async () => {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return ready;
}

export const looksLikePdf = (url: string, contentType = '') => /application\/pdf/i.test(contentType) || /\.pdf(\?|#|$)/i.test(new URL(url).pathname);

export interface PdfText {
  title?: string;
  author?: string;
  pages: number;
  text: string;
}

/** Downloads a PDF (up to 25 MB) and returns its text, page by page, up to ~60,000 characters. */
export async function readPdf(url: string, signal?: AbortSignal): Promise<PdfText | null> {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/pdf,*/*' }, signal: signal ?? AbortSignal.timeout(25_000), redirect: 'follow' });
  if (!res.ok) return null;
  const size = Number(res.headers.get('content-length') ?? 0);
  if (size > 25_000_000) return null;
  const data = new Uint8Array(await res.arrayBuffer());
  // Not a PDF after all (a login page, an HTML viewer).
  if (String.fromCharCode(...data.slice(0, 5)) !== '%PDF-') return null;
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  try {
    const parts: string[] = [];
    let length = 0;
    for (let p = 1; p <= Math.min(doc.numPages, 60) && length < 60_000; p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      const page = content.items
        .map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      parts.push(page);
      length += page.length;
    }
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
    return { title: info.Title?.trim() || undefined, author: info.Author?.trim() || undefined, pages: doc.numPages, text: parts.join('\n\n').slice(0, 60_000) };
  } finally {
    void doc.destroy();
  }
}
