#!/usr/bin/env node
import('../src/cli.js').catch((err) => {
  if (process.env.ELORA_DEBUG) {
    // Full stack — name + message + every frame.
    process.stderr.write(`elora-voss: failed to start: ${err.message}\n`);
    if (err.stack) process.stderr.write(err.stack + '\n');
  } else {
    process.stderr.write(`elora-voss: failed to start: ${err.message}\n`);
    process.stderr.write(`(re-run with ELORA_DEBUG=1 for the full stack trace)\n`);
  }
  process.exit(1);
});