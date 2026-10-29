import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// SPA fallback for Apache: unknown paths under the base serve index.html so refreshing /techquiz/admin works.
const htaccess = (base: string): Plugin => ({
  name: 'apache-htaccess',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: '.htaccess',
      source: [
        'Options -Indexes',
        '<IfModule mod_rewrite.c>',
        'RewriteEngine On',
        `RewriteBase ${base}`,
        'RewriteRule ^index\\.html$ - [L]',
        'RewriteCond %{REQUEST_FILENAME} !-f',
        'RewriteCond %{REQUEST_FILENAME} !-d',
        'RewriteRule . index.html [L]',
        '</IfModule>',
        '<IfModule mod_headers.c>',
        '<FilesMatch "^index\\.html$">',
        'Header set Cache-Control "no-cache"',
        '</FilesMatch>',
        '<FilesMatch "\\.(js|css|woff2?)$">',
        'Header set Cache-Control "public, max-age=31536000, immutable"',
        '</FilesMatch>',
        '</IfModule>',
        '',
      ].join('\n'),
    })
  },
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const apache = mode === 'apache'

  if (apache && !/^https:\/\//.test(env.VITE_API_BASE || '')) {
    throw new Error('Apache build: set VITE_API_BASE to the Vercel address (https://...) in frontend/.env.apache')
  }
  const base = apache ? env.VITE_BASE_PATH || '/techquiz/' : '/'

  return {
    base,
    plugins: [react(), apache && htaccess(base)],
    server: {
      host: true,
      port: 5173,
    },
  }
})
