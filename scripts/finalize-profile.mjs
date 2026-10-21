import { lstat, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('Usage: finalize-profile.mjs PROFILE_DIRECTORY');
const modules = join(root, 'node_modules');
async function normalize(dir) {
  for (const name of await readdir(dir)) {
    if (name.startsWith('.')) continue;
    const entry = join(dir, name);
    const info = await lstat(entry);
    if (name.startsWith('@') && info.isDirectory()) { await normalize(entry); continue; }
    if (!info.isSymbolicLink()) continue;
    const target = await realpath(entry);
    if (!target.startsWith('/opt/')) throw new Error(`Seed link escapes immutable source tree: ${entry}`);
    await rm(entry);
    await symlink(target, entry);
  }
}
await normalize(modules);

// Ecosystem packages are installed as dependencies, but some do not declare
// dsh.bundle and DSH intentionally skips them at startup. Keep them available
// to Tavern's own loader and do not advertise them as startup bundles.
const versions = JSON.parse(await readFile('/opt/dsh/versions.json', 'utf8'));
const ecosystem = new Set(Object.keys(versions.ecosystem ?? {}));
const manifestPath = join(root, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const bundles = manifest.dsh?.profile?.bundles;
if (Array.isArray(bundles)) {
  const kept = [];
  for (const name of bundles) {
    if (!ecosystem.has(name)) { kept.push(name); continue; }
    const pkg = JSON.parse(await readFile(join(modules, name, 'package.json'), 'utf8'));
    if (pkg.dsh?.bundle !== undefined) kept.push(name);
    else console.log(`profile: ${name} declares no dsh.bundle; retained as a dependency only`);
  }
  if (kept.length !== bundles.length) {
    manifest.dsh.profile.bundles = kept;
    if (Array.isArray(manifest.dshTavern?.managedBundles)) manifest.dshTavern.managedBundles = kept;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  }
}
