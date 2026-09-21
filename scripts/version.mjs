// One version, in the manifests that have to agree.
//
//   node scripts/version.mjs            what every manifest says
//   node scripts/version.mjs 0.2.0      set them all
//   node scripts/version.mjs minor      the next minor (patch stays 0), or `patch`
//
// Prints the resulting version, which tag.yml reads.
import { readFileSync, writeFileSync } from 'node:fs';

const files = ['package.json', 'packages/extension/package.json', 'packages/core/package.json',
  'packages/driver-sqlite/package.json', 'packages/driver-postgres/package.json', 'packages/driver-mssql/package.json',
  'packages/language-prql/package.json'];
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const current = read('packages/extension/package.json').version;
const arg = process.argv[2];

if (!arg) {
  for (const f of files) console.error(`${f.padEnd(40)} ${read(f).version}`);
  const all = files.map((f) => read(f).version);
  if (new Set(all).size !== 1) { console.error('they disagree; run: node scripts/version.mjs <version>'); process.exit(1); }
  console.log(current);
  process.exit(0);
}

const [major, minor, patch] = current.split('.').map(Number);
const next = arg === 'minor' ? `${major}.${minor + 1}.0` : arg === 'patch' ? `${major}.${minor}.${patch + 1}` : arg;
if (!/^\d+\.\d+\.\d+$/.test(next)) { console.error(`${arg} is not a version`); process.exit(1); }
for (const f of files) {
  const pkg = read(f);
  pkg.version = next;
  writeFileSync(f, JSON.stringify(pkg, null, 2) + '\n');
}
console.error(`${current} -> ${next}`);
console.log(next);
