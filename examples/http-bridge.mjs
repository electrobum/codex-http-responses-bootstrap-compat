import http from 'node:http';
import https from 'node:https';
import { normalizeCodexBootstrapRequest } from '../src/normalizer.mjs';

const host = process.env.CODEX_COMPAT_HOST || '127.0.0.1';
const port = Number(process.env.CODEX_COMPAT_PORT || '18766');
const upstreamBaseUrl = process.env.CODEX_COMPAT_UPSTREAM_BASE_URL;

if (!upstreamBaseUrl) {
  throw new Error('Set CODEX_COMPAT_UPSTREAM_BASE_URL to your existing upstream base URL. Do not put credentials in this script.');
}

function log(event) {
  // Deliberately metadata-only: never log request bodies or headers.
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
}

function relay(req, res, raw) {
  let payload = raw;
  try {
    const normalized = normalizeCodexBootstrapRequest(JSON.parse(raw.toString('utf8')));
    if (normalized.changed) {
      payload = Buffer.from(JSON.stringify(normalized.body));
      log({
        event: 'codex_bootstrap_normalized',
        delegation_count: normalized.delegationCount,
        automation_count: normalized.automationCount,
        path: req.url,
      });
    }
  } catch {
    // Preserve non-JSON payloads exactly; the upstream remains authoritative.
  }

  const upstream = new URL(req.url, upstreamBaseUrl);
  const client = upstream.protocol === 'https:' ? https : http;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers['content-length'];
  headers['content-length'] = String(payload.length);

  const upstreamRequest = client.request(upstream, { method: req.method, headers }, upstreamResponse => {
    res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });
  upstreamRequest.on('error', error => {
    log({ event: 'upstream_error', path: req.url, error: String(error) });
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'bridge_error', message: 'Compatibility bridge upstream error' } }));
  });
  upstreamRequest.end(payload);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, normalizer: 'narrow-bootstrap-only' }));
    return;
  }
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => relay(req, res, Buffer.concat(chunks)));
});

server.listen(port, host, () => {
  log({ event: 'ready', host, port });
});
