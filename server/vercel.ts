import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { app } from './app';

// The API as one Vercel Function. scripts/build-vercel.mjs bundles this file.
const listener = getRequestListener(app.fetch);

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // Vercel routes /api/<path> here as /api?__path=<path>; put the real path back.
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.searchParams.get('__path');
  if (path !== null) {
    url.searchParams.delete('__path');
    req.url = `/api/${path}${url.search}`;
  }
  return listener(req, res);
}
