import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/web',
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    // il solo chunk `three` (three.core + WebGLRenderer, nessun altro modulo) misura ~737 kB minificato
    // (~187 kB gzip) e non è ulteriormente divisibile; tutti gli altri chunk restano < 250 kB
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // vendor in chunk dedicati (#19): react, three, r3f/drei, poi il resto.
        // Priorità più alte prima: senza il gruppo react, r3f se lo porterebbe dietro (includeDependenciesRecursively)
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 4 },
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 3 },
            { name: 'r3f', test: /node_modules[\\/]@react-three[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  server: { proxy: { '/api': 'http://127.0.0.1:4317' } },
  test: {
    root: '.',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
