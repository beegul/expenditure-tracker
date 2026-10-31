import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.env.SERVE_DIST === '1' ? 'dist' : '.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv' };
http.createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const file = path === root ? resolve(root, 'index.html') : path;
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
  } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'EISDIR') console.error('Request failed:', e.message);
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(Number(process.env.PORT || 5173), '127.0.0.1', () => console.log('Commonplace ready at http://127.0.0.1:' + (process.env.PORT || 5173)));
