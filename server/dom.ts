// The HTML parser (jsdom) and article extractor are heavy, and jsdom is picky
// about Node versions. They load the first time a page actually needs parsing,
// never at startup, so a health check or a dig never waits on them.

let jsdom: Promise<typeof import('jsdom')> | undefined;
let readabilityLib: Promise<typeof import('@mozilla/readability')> | undefined;

/** Parses HTML into a document (scripts never run; console noise is swallowed). */
export async function parseHtml(html: string, url?: string): Promise<Document> {
  const { JSDOM, VirtualConsole } = await (jsdom ??= import('jsdom'));
  return new JSDOM(html, { url, virtualConsole: new VirtualConsole() }).window.document as unknown as Document;
}

/** The readable article in a page, as Firefox's Reader View would see it. */
export async function readArticle(doc: Document) {
  const { Readability } = await (readabilityLib ??= import('@mozilla/readability'));
  return new Readability(doc).parse();
}
