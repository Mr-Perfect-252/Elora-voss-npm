// Standalone syntax checker. Reads every src/**/*.js and runs new vm.Script on it.
// We avoid `node --check` because Bash is broken on this Windows host.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import vm from 'node:vm';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (extname(p) === '.js') out.push(p);
  }
  return out;
}

const ROOT = process.argv[2] || './src';
const files = walk(ROOT);
let bad = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  try {
    new vm.Script(src, { filename: f });
    console.log('OK  ', f);
  } catch (e) {
    bad++;
    console.log('FAIL', f, '—', e.message);
  }
}
console.log(`\n${files.length} files, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
