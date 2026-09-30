# 🕳️ Rabbit Hole

A visual research board for falling down rabbit holes. Type a topic and it pulls
files from dozens of free archives at once, then an AI strings everything
together on a detective-style cork board: people, places, dates, photos,
clippings, videos, a pinned map with red circles, open questions, and new
rabbit holes to fall into next.

## Run it

```bash
npm install
npm run dev          # API on :8787 + app on http://localhost:5173
```

It works with **zero keys**. A keyless AI is the built-in fallback.
For faster, smarter answers, paste free keys into `.env` (no credit card for any of them).

```bash
npm run check:keys      # test every key in .env and show what's left of its free limits
npm run check:health    # is the server up? add a URL to check the online version:
                        #   npm run check:health -- https://your-app.vercel.app
npm run check:ai        # test every AI provider you've configured, with rate limits
npm run check:sources   # test every research source live
npm run build && npm start   # production: one server hosts API + app
```

## Keys live only on the server

Set `CONTACT_EMAIL` in `.env`: Wikipedia and OpenStreetMap throttle apps that
don't identify themselves.

Everything secret is in `.env`, read by the Node server. The browser only talks
to this app's own `/api`, and never sees keys, provider names or models.
`.env` is git-ignored; `.env.example` is the template.

**AI fallback chain** (tried in order, skipped if no key): Groq → Gemini →
OpenRouter (free models only) → Cohere → Z.ai → NVIDIA NIM → Hugging Face →
Cloudflare Workers AI → Ollama (local, optional) → Pollinations (no key).
If a provider fails, rate-limits or retires a model, the next one answers, and
retired models are replaced automatically from the provider's model list.

## Research sources (70, all free)

| Group | Sources |
| --- | --- |
| Knowledge | Wikipedia, Wikidata, Wikimedia Commons, Wikiquote, Wiktionary, Wikisource, Stanford Encyclopedia of Philosophy, Urban Dictionary |
| Archives | Internet Archive, Wayback Machine, Open Library, Project Gutenberg, Europeana, UK National Archives, declassified CIA/FBI/NSA files, The Black Vault, MuckRock, DTIC, Smithsonian Magazine |
| Museums | Smithsonian, The Met, Art Institute of Chicago, Cleveland Museum of Art, V&A, Wellcome Collection |
| Academic | OpenAlex, arXiv, Crossref, Europe PMC / PubMed, Semantic Scholar, Zenodo, OEIS |
| Community | Reddit (official API or PullPush archive), Hacker News, Lemmy, Stack Exchange |
| News | Google News, GDELT |
| Web | Brave / DuckDuckGo (or Tavily / Serper with a free key), Wiby (old web), GitHub |
| Media | YouTube (+ transcripts), Dailymotion, Apple Podcasts, Openverse, NASA Images, TVmaze, MusicBrainz |
| Weird | Atlas Obscura, Lost Media Wiki, SCP Wiki, TV Tropes, RationalWiki, Snopes, Know Your Meme, Websleuths / Doe Network, Fandom wikis, Bellingcat, Damn Interesting, Futility Closet, Public Domain Review, Cryptome, Substack, OCCRP Aleph (key) |
| Places | OpenStreetMap (Nominatim + Photon), Wikipedia nearby, iNaturalist |
| Records | CourtListener, Federal Register, SEC EDGAR, FBI Wanted |

Choose which ones every dig uses in **Customize → Sources**. Search any of them
by hand in the **Archives** tab and drag results onto the board.

## Using it

The first visit opens a short **How it works** guide (the **?** button reopens it).

- **Dig**: type anything (or paste a link or YouTube URL) in the top bar. Clues
  land on the board live as each archive reports back. Off-topic results are
  filtered out, and the AI tosses any it judges irrelevant. Every dig also pulls
  photos, archive recordings, films and podcast episodes.
- **Weaving**: when a dig finishes, each clue is strung to the people and places
  it mentions and seated next to them; cards shared with earlier cases are tied
  across the board.
- **Keep falling ×3** on a case file follows three rabbit holes automatically.
- **Fall in**: every rabbit-hole card opens a new case file, connected to the
  one it came from. The depth meter tracks how far down you are.
- **Partner**: chat with the AI about the board or the selected card, always in
  the context of its case. It searches first, cites sources, links board cards
  you can click to fly to, and can act on the board ("bring that picture on the
  board", "connect these two", "leave a note").
- **Reader**: open any source in-app. Internet Archive items show their full
  scanned text, Open Library books their record and free scan, Reddit and
  Hacker News threads their comments, Wikipedia the full article. Pages behind
  logins or bot checks fall back to the Wayback Machine, or show a clear locked
  card you can unpin.
- **Undo**: Ctrl+Z (or the Undo toast) brings back deleted cards and strings.
- **Find on board**: the magnifier in the tool tray.
- Drag the inner edge of either side panel to resize it; collapse it to a slim
  rail with the « » buttons.
- **Views**: Board, Web (force graph), Map, and Timeline all show the same data.
- **Make it yours**: five surfaces (cork, mind palace, blueprint, chalkboard,
  scrapbook), string styles, handwriting, messy pinning, pin colors, card
  styles, and **Arrange by data**, which re-pins the board by date, location,
  kind or source.
- Drag links, images or text straight onto the board. Double-click the cork
  for a sticky note. `/` focuses the dig bar, `N` adds a note, `Ctrl+K` opens search.

Boards save automatically in the browser (IndexedDB). Export or import them in
**Customize → Save & share**.

## Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · React Flow · Zustand ·
react-force-graph · Leaflet · Hono on Node · jsdom + Readability.

```
server/     API: LLM fallback chain, dig pipeline, scraper, 70 source adapters
shared/     types and source metadata used by both sides
src/        the React app: board, views, panels, stores
scripts/    check:keys, check:health, check:ai and check:sources
```
