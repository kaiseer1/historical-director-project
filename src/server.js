import http from 'node:http';
import path from 'node:path';
import { readAsset } from './runtime.js';

/**
 * The sidebar's three static files, addressed the way runtime.js addresses
 * everything bundled: a repo-relative, forward-slash path. Inside the built
 * executable there is no renderer folder on disk to read from, so serving them
 * has to go through the same door as the companion mod's files.
 */
const RENDERER = 'src/renderer';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/**
 * The sidebar's host: static files, a server-sent-event stream for live
 * updates, and the handful of endpoints the player's verdict travels over.
 *
 * Bound to 127.0.0.1 only. The Director's whole job is to stage privileged
 * changes to a running game, and that is not something to expose on a network
 * interface for the sake of a UI.
 */
export function createServer(handlers) {
  /** @type {Set<http.ServerResponse>} */
  const clients = new Set();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // --- live updates ---
    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    // --- API ---
    if (url.pathname.startsWith('/api/')) {
      try {
        const body = await readBody(req);
        const action = url.pathname.slice(5);
        const handler = handlers[action];
        if (!handler) return json(res, 404, { error: `no such endpoint: ${action}` });
        const result = await handler(body, url.searchParams);
        return json(res, 200, result ?? { ok: true });
      } catch (err) {
        return json(res, 500, { error: String(err?.message ?? err) });
      }
    }

    // --- static ---
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);

    // Normalised before use, so "..%2f" and friends cannot walk out of the
    // renderer prefix. This used to be a startsWith check against a resolved
    // filesystem path; assets have no filesystem, so the check moves here and
    // has to hold on the requested name itself.
    const safe = path.posix.normalize(file).replace(/^(\.\.\/)+/, '');
    if (safe.startsWith('..') || path.posix.isAbsolute(safe)) {
      res.writeHead(404).end('not found');
      return;
    }

    const body = readAsset(`${RENDERER}/${safe}`);
    if (!body) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(safe)] ?? 'application/octet-stream' });
    res.end(body);
  });

  /**
   * Push an event to every connected sidebar.
   * @param {string} type
   * @param {any} payload
   */
  function broadcast(type, payload) {
    const frame = `data: ${JSON.stringify({ type, payload })}\n\n`;
    for (const c of clients) {
      try { c.write(frame); } catch { clients.delete(c); }
    }
  }

  return { server, broadcast };
}

/** @param {http.IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve) => {
    if (req.method !== 'POST') return resolve({});
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
