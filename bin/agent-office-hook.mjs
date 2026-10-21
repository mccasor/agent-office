#!/usr/bin/env node
// Hook di Claude Code: legge il payload JSON da stdin e lo appende al file eventi.
// Non deve mai far fallire né rallentare Claude: exit 0 sempre, nessun output su stdout.
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const { runHook } = await import('../dist/server/hooks/index.js');
  await runHook(Buffer.concat(chunks).toString('utf8'));
} catch {
  // ignorato di proposito
}
process.exit(0);
