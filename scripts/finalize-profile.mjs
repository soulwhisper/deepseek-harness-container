import { lstat, readdir, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Keep the documented /opt/dsh/runtime alias in generated profile links.
// pnpm may resolve the alias to /opt/dsh/docker/runtime; both point at the
// same immutable tree, but stable links make the image contract inspectable.
export function stableImmutableTarget(entry, recorded) {
  if (typeof recorded !== 'string' || !recorded) throw new Error(`Invalid seed link: ${entry}`);
  const lexical = resolve(dirname(entry), recorded);
  if (!lexical.startsWith('/opt/')) throw new Error(`Seed link escapes immutable source tree: ${entry}`);
  if (lexical === '/opt/dsh/docker/runtime' || lexical.startsWith('/opt/dsh/docker/runtime/')) {
    return `/opt/dsh/runtime${lexical.slice('/opt/dsh/docker/runtime'.length)}`;
  }
  return lexical;
}

async function normalize(dir) {
  for (const name of await readdir(dir)) {
    if (name.startsWith('.')) continue;
    const entry = join(dir, name);
    const info = await lstat(entry);
    if (name.startsWith('@') && info.isDirectory()) { await normalize(entry); continue; }
    if (!info.isSymbolicLink()) continue;
    const target = await realpath(entry);
    if (!target.startsWith('/opt/')) throw new Error(`Seed link escapes immutable source tree: ${entry}`);
    const stable = stableImmutableTarget(entry, await readlink(entry));
    await rm(entry);
    await symlink(stable, entry);
  }
}

export async function finalizeProfile(root) {
  if (!root) throw new Error('Usage: finalize-profile.mjs PROFILE_DIRECTORY');
  const modules = join(root, 'node_modules');
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await finalizeProfile(process.argv[2]);
}
