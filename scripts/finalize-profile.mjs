import { lstat, readdir, readlink, realpath, rm, symlink } from 'node:fs/promises';
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
  await normalize(join(root, 'node_modules'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await finalizeProfile(process.argv[2]);
}
