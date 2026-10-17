// @vitest-environment node
// scripts/fetch-assets.mjs, its NETWORK object: what a download refuses. Tested against a throw-away server on 127.0.0.1, so no
// real network is used. Downloads are untrusted: no redirect is followed, a body that is not a JPEG or PNG is not read, and a body
// over the cap is refused as soon as its Content-Length says so, or as soon as the bytes already read show it (the transfer is cut).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_DOWNLOAD_BYTES, MAX_JSON_BYTES, NETWORK } from '../scripts/fetch-assets.mjs';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const hits: string[] = [];
const routes = new Map<string, Handler>();
let server: Server;
let base = '';
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// The streaming route's state, read by the test that cuts it.
const stream = { written: 0, closed: false };

beforeAll(async () => {
  routes.set('/jpeg', (_req, res) => {
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    res.end('JPEGDATA');
  });
  routes.set('/png', (_req, res) => {
    res.writeHead(200, { 'content-type': 'image/png; charset=binary' });
    res.end('PNGDATA');
  });
  routes.set('/html', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>an error page</html>');
  });
  routes.set('/svg', (_req, res) => {
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    res.end('<svg/>');
  });
  routes.set('/redirect', (_req, res) => {
    res.writeHead(302, { location: `${base}/jpeg` });
    res.end();
  });
  routes.set('/moved', (_req, res) => {
    res.writeHead(301, { location: 'https://example.org/elsewhere.jpg' });
    res.end();
  });
  routes.set('/gone', (_req, res) => {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('no such file');
  });
  routes.set('/declared-big', (_req, res) => {
    // Says it is 9 MB and then sends nothing: a client that reads before it checks would wait for ever.
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(9 * 1024 * 1024) });
    res.flushHeaders();
  });
  routes.set('/stream-big', (_req, res) => {
    stream.written = 0;
    stream.closed = false;
    res.writeHead(200, { 'content-type': 'image/jpeg' });    // no Content-Length: chunked
    const chunk = Buffer.alloc(64 * 1024, 1);
    res.on('close', () => {
      stream.closed = true;
    });
    const tick = (): void => {
      if (stream.closed) return;
      if (stream.written >= 500) {
        res.end();
        return;
      }
      res.write(chunk);
      stream.written += 1;
      setTimeout(tick, 10);          // slow enough that a busy test machine still cuts it far short of 500 chunks (5 s)
    };
    tick();
  });
  routes.set('/json', (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"query":{"pages":[]}}');
  });
  routes.set('/json-big', (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(`{"x":"${'y'.repeat(5000)}"}`);
  });
  server = createServer((req, res) => {
    hits.push(req.url ?? '');
    const handler = routes.get((req.url ?? '').split('?')[0]!);
    if (handler) handler(req, res);
    else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
});

describe('NETWORK.download', () => {
  it('returns the bytes and the type of a JPEG or a PNG (a charset after the type is ignored)', async () => {
    const jpeg = await NETWORK.download(`${base}/jpeg`);
    expect([jpeg.type, jpeg.buf.toString()]).toEqual(['image/jpeg', 'JPEGDATA']);
    const png = await NETWORK.download(`${base}/png`);
    expect([png.type, png.buf.toString()]).toEqual(['image/png', 'PNGDATA']);
  });
  it('does not follow a redirect: it refuses, says where it pointed, and never asks the target', async () => {
    const before = hits.filter((h) => h === '/jpeg').length;
    await expect(NETWORK.download(`${base}/redirect`)).rejects.toThrow(/answered 302, a redirect to http:\/\/127\.0\.0\.1:\d+\/jpeg\. Redirects are not followed/);
    await expect(NETWORK.download(`${base}/moved`)).rejects.toThrow(/answered 301, a redirect to https:\/\/example\.org\/elsewhere\.jpg/);
    expect(hits.filter((h) => h === '/jpeg').length, 'the redirect target was never requested').toBe(before);
  });
  it('refuses a body that is not a JPEG or PNG (an HTML error page, an SVG) and an error status', async () => {
    await expect(NETWORK.download(`${base}/html`)).rejects.toThrow(/is text\/html, not a JPEG or PNG/);
    await expect(NETWORK.download(`${base}/svg`)).rejects.toThrow(/is image\/svg\+xml, not a JPEG or PNG/);
    await expect(NETWORK.download(`${base}/gone`)).rejects.toThrow(/HTTP 404 from /);
  });
  it('refuses a Content-Length over the cap before it reads a single byte', async () => {
    expect(MAX_DOWNLOAD_BYTES).toBe(8 * 1024 * 1024);
    await expect(NETWORK.download(`${base}/declared-big`)).rejects.toThrow(/says it is 9437184 bytes, over the 8388608-byte cap/);
  });
  it('cuts off a body with no Content-Length as soon as the bytes read pass the cap: the server sees the connection close long before it is done', async () => {
    await expect(NETWORK.download(`${base}/stream-big`, 100_000)).rejects.toThrow(/is over the 100000-byte cap/);
    for (let i = 0; i < 100 && !stream.closed; i++) await sleep(20);
    expect(stream.closed, 'the transfer was cancelled').toBe(true);
    expect(stream.written, 'of 500 chunks the server meant to send').toBeLessThan(250);
  });
  it('accepts a body of exactly the cap and refuses one byte more', async () => {
    await expect(NETWORK.download(`${base}/jpeg`, 8)).resolves.toMatchObject({ type: 'image/jpeg' });
    await expect(NETWORK.download(`${base}/jpeg`, 7)).rejects.toThrow(/over the 7-byte cap|says it is 8 bytes, over the 7-byte cap/);
  });
});

describe('NETWORK.getJson (the Commons API answer)', () => {
  it('parses the answer, refuses a redirect and an error status, and caps the size', async () => {
    expect(MAX_JSON_BYTES).toBe(2 * 1024 * 1024);
    await expect(NETWORK.getJson(`${base}/json`)).resolves.toEqual({ query: { pages: [] } });
    await expect(NETWORK.getJson(`${base}/redirect`)).rejects.toThrow(/Redirects are not followed/);
    await expect(NETWORK.getJson(`${base}/gone`)).rejects.toThrow(/HTTP 404 from /);
    await expect(NETWORK.getJson(`${base}/json-big`, 1000)).rejects.toThrow(/over the 1000-byte cap/);
    await expect(NETWORK.getJson(`${base}/json-big`)).resolves.toMatchObject({ x: expect.any(String) });
  });
});
