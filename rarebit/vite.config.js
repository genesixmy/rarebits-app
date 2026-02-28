import path from 'node:path';
import react from '@vitejs/plugin-react';
import { createLogger, defineConfig } from 'vite';
import inlineEditPlugin from './plugins/visual-editor/vite-plugin-react-inline-editor.js';
import editModeDevPlugin from './plugins/visual-editor/vite-plugin-edit-mode.js';
import iframeRouteRestorationPlugin from './plugins/vite-plugin-iframe-route-restoration.js';

const isDev = process.env.NODE_ENV !== 'production';

// ------------------- Error Handlers -------------------
const configHorizonsViteErrorHandler = `/*... sama seperti sedia ada ...*/`;
const configHorizonsRuntimeErrorHandler = `/*... sama seperti sedia ada ...*/`;
const configHorizonsConsoleErrroHandler = `/*... sama seperti sedia ada ...*/`;
const configWindowFetchMonkeyPatch = `/*... sama seperti sedia ada ...*/`;
const configNavigationHandler = `/*... sama seperti sedia ada ...*/`;

// ------------------- Inject scripts into index.html -------------------
const addTransformIndexHtml = {
  name: 'add-transform-index-html',
  transformIndexHtml(html) {
    const tags = [
      { tag: 'script', attrs: { type: 'module' }, children: configHorizonsRuntimeErrorHandler, injectTo: 'head' },
      { tag: 'script', attrs: { type: 'module' }, children: configHorizonsViteErrorHandler, injectTo: 'head' },
      { tag: 'script', attrs: { type: 'module' }, children: configHorizonsConsoleErrroHandler, injectTo: 'head' },
      { tag: 'script', attrs: { type: 'module' }, children: configWindowFetchMonkeyPatch, injectTo: 'head' },
      { tag: 'script', attrs: { type: 'module' }, children: configNavigationHandler, injectTo: 'head' },
    ];
    return { html, tags };
  },
};

// ------------------- Custom logger -------------------
console.warn = () => {}; // disable console.warn
const logger = createLogger();
const loggerError = logger.error;
logger.error = (msg, options) => {
  if (options?.error?.toString().includes('CssSyntaxError: [postcss]')) return;
  loggerError(msg, options);
};

// ------------------- Vite Config -------------------
export default defineConfig({
  customLogger: logger,
  plugins: [
    ...(isDev ? [inlineEditPlugin(), editModeDevPlugin(), iframeRouteRestorationPlugin()] : []),
    react(),
    addTransformIndexHtml
  ],
  server: {
    cors: true,
    headers: { 'Cross-Origin-Embedder-Policy': 'credentialless' },
    allowedHosts: true,
  },
  resolve: {
    extensions: ['.jsx', '.js', '.tsx', '.ts', '.json'],
    alias: { '@': path.resolve(__dirname, './src') },
  },
 build: {
  outDir: path.resolve(__dirname, 'dist'), // ✅ pastikan ini betul
  emptyOutDir: true,
  rollupOptions: {
    external: ['@babel/parser','@babel/traverse','@babel/generator','@babel/types']
  }
}
});
