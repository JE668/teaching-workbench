import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'shared');
const TARGETS = ['server/src/shared', 'web/src/shared'];
const check = process.argv.includes('--check');

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out.sort();
}

if (!fs.existsSync(SRC)) {
  console.error('missing source dir: ' + SRC);
  process.exitCode = 1;
}
const sourceFiles = listFiles(SRC);
let failed = 0;

for (const rel of TARGETS) {
  const target = path.join(ROOT, rel);
  if (check) {
    const same = fs.existsSync(target);
    const targetFiles = same ? listFiles(target) : [];
    const drift = [];
    if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) drift.push('file list differs');
    for (const f of sourceFiles) {
      if (!targetFiles.includes(f)) continue;
      const a = fs.readFileSync(path.join(SRC, f));
      const b = fs.readFileSync(path.join(target, f));
      if (!a.equals(b)) drift.push(f);
    }
    if (drift.length === 0) {
      console.log('OK   ' + rel + ' matches shared/');
    } else {
      failed++;
      console.error('FAIL ' + rel + ' drifted from shared/: ' + drift.join(', '));
      console.error('     run: npm run sync:shared');
    }
  } else {
    fs.rmSync(target, { recursive: true, force: true });
    for (const f of sourceFiles) {
      const dest = path.join(target, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(SRC, f), dest);
    }
    console.log('synced -> ' + rel + ' (' + sourceFiles.length + ' files)');
  }
}

if (check && failed > 0) process.exitCode = 1;
if (check) console.log('shared/ is the single source of truth, copies are in sync');
