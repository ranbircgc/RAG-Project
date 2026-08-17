import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/ollama/')) {
    try {
      const body = req.method === 'POST' ? await new Promise((resolve, reject) => { let data=''; req.on('data', c => data += c); req.on('end', () => resolve(data)); req.on('error', reject); }) : undefined;
      const upstream = await fetch(`http://127.0.0.1:11434/api/${url.pathname.slice('/api/ollama/'.length)}${url.search}`, { method:req.method, headers:{ 'content-type':req.headers['content-type'] || 'application/json' }, body });
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.writeHead(503, { 'content-type':'application/json' }); res.end(JSON.stringify({ error:'Ollama is unavailable. Start it with: ollama serve' }));
    }
    return;
  }
  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = normalize(join(root, requestPath));
  if (!filePath.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
  try { const info = await stat(filePath); if (!info.isFile()) throw Error(); const content = await readFile(filePath); res.writeHead(200, { 'content-type':types[extname(filePath)] || 'application/octet-stream', 'cache-control':'no-store' }); res.end(content); }
  catch { res.writeHead(404, { 'content-type':'text/plain' }); res.end('Not found'); }
});

server.listen(3000, '127.0.0.1', () => console.log('RAG Studio: http://127.0.0.1:3000'));
