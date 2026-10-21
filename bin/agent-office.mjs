#!/usr/bin/env node
import { main } from '../dist/cli.js';

// un errore imprevisto in una lettura asincrona non deve chiudere il server: lo si registra e si continua
process.on('unhandledRejection', (err) => {
  console.error('agent-office: errore non gestito:', err instanceof Error ? err.stack : err);
});

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
