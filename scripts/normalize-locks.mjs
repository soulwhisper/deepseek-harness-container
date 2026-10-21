// Profile locks are generated in /opt/dsh-seed and later copied to
// $DSH_HOME. pnpm records absolute link: specifiers as paths relative to the
// workspace root, so the copied lock would point at the wrong home. Rewrite
// only the recorded version of absolute link specifiers; the specifier and
// every registry/git/file entry stay untouched.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function normalizeLockText(text) {
  return text.replace(
    /(\n[ \t]+specifier: link:(\/[^\n]+)\n[ \t]+version: )link:[^\n]+/gu,
    (_match, prefix, absolute) => `${prefix}link:${absolute}`,
  );
}

export function relativeLinkCount(text) {
  return [...text.matchAll(/\n[ \t]+specifier: link:\/[^\n]+\n[ \t]+version: link:(?!\/)/gu)].length;
}

export function normalizeLockLinks(lock) {
  for (const importer of Object.values(lock.importers ?? {})) {
    for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const row of Object.values(importer?.[kind] ?? {})) {
        if (typeof row?.specifier === 'string' && row.specifier.startsWith('link:/')
          && typeof row.version === 'string' && row.version.startsWith('link:')) {
          row.version = `link:${row.specifier.slice('link:'.length)}`;
        }
      }
    }
  }
  return lock;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length < 3) throw new Error('Usage: node normalize-locks.mjs LOCK_FILE...');
  for (const path of process.argv.slice(2)) {
    const original = await readFile(path, 'utf8');
    const normalized = normalizeLockText(original);
    if (normalized === original) continue;
    await writeFile(path, normalized);
    console.log(`normalized absolute link versions: ${path}`);
  }
}
