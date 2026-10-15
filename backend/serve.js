// HTTP/HTTPS server creation shared by server.js and game-server.js.
const http = require('http');
const https = require('https');
const os = require('os');
const fs = require('fs');
const path = require('path');

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
}

// HTTPS=true serves over TLS with a self-signed certificate (generated in certs/ on first run)
// for LAN-only use. Not needed behind Cloudflare Tunnel, which provides HTTPS itself.
function tlsOptions() {
  const dir = path.join(__dirname, 'certs');
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
    const selfsigned = require('selfsigned');
    const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...lanAddresses().map(ip => ({ type: 7, ip }))];
    const pems = selfsigned.generate([{ name: 'commonName', value: 'TechSprint' }], {
      days: 365, keySize: 2048, algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames }],
    });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(keyFile, pems.private);
    fs.writeFileSync(certFile, pems.cert);
    console.log('Generated a self-signed certificate in backend/certs/');
  }
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
}

const useHttps = process.env.HTTPS === 'true';
const scheme = useHttps ? 'https' : 'http';
const createHttpServer = handler => (useHttps ? https.createServer(tlsOptions(), handler) : http.createServer(handler));

module.exports = { createHttpServer, lanAddresses, scheme };
