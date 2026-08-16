import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

/**
 * A dependency-free static server for the self-test mock pages.
 *
 * The mocks are served over http rather than opened as file:// URLs so they run
 * under the same origin semantics, media-query handling, and console behaviour
 * as the real preview build. A gate that behaves differently in the self-test
 * than in the real run would prove nothing about the real run.
 */

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webm': 'video/webm',
};

export function serveDirectory(root, port) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const requested = decodeURIComponent(url.pathname);
      const relative = normalize(requested).replace(/^([/\\])+/, '');

      // Refuse anything that climbs out of the served directory.
      if (relative.split(sep).includes('..')) {
        response.writeHead(403).end('Forbidden');
        return;
      }

      const path = join(root, relative === '' ? 'index.html' : relative);
      const body = await readFile(path);
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
