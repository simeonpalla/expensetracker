// Minimal static server for Playwright E2E runs. Serves the Vite build
// output (dist/) — all /.netlify/functions/* calls are stubbed inside the
// tests, so no Netlify dev server or Supabase credentials are needed.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', 'dist');
const PORT = process.env.PORT || 4173;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404).end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
    });
}).listen(PORT, () => console.log(`e2e static server on http://localhost:${PORT}`));
