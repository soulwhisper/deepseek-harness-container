import { copyFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// dsh-tavern-wrongbook expects its host-patch runner under
// <tavern data>/tools/mvu-api-test/. The image applies the supported patches
// at build time; this seed gives the plugin's status panel the same scripts.
// Image-managed and recognized upstream copies are migrated; a custom
// patch-all.mjs is left untouched.
const DEFAULT_SOURCE = '/opt/dsh/seed/tavern-tools/mvu-api-test';
const MANAGED_MARKER = 'Image-managed subset of dsh-tavern-wrongbook';
const UPSTREAM_DEBUG = "const DEBUG = DATA + '/tools'";
const UPSTREAM_SHA256 = '32c52b6ecdd78cb03b8b70f1b7cfefc8b536fa680a323aa619945d635a75c144';

async function patchAllState(target) {
  const file = join(target, 'patch-all.mjs');
  if (!existsSync(file)) return 'missing';
  const text = await readFile(file, 'utf8');
  if (text.includes(MANAGED_MARKER)) return 'managed';
  if (text.includes(UPSTREAM_DEBUG)
    || createHash('sha256').update(text).digest('hex') === UPSTREAM_SHA256) return 'upstream';
  return 'custom';
}

async function copyBundle(source, target) {
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, '.mvu-api-test-'));
  try {
    const staged = join(staging, 'bundle');
    await cp(source, staged, { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(staged, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function copyManaged(source, target, { overwrite }) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (!overwrite && existsSync(to)) continue;
    const temp = join(target, `.${entry.name}.tmp-${process.pid}`);
    if (entry.isDirectory()) await cp(from, temp, { recursive: true, force: true });
    else await copyFile(from, temp);
    await rename(temp, to);
  }
}

export async function seedTavernTools({
  home = process.env.DSH_HOME ?? '/data/dsh',
  source = process.env.DSH_TAVERN_TOOLS_SEED ?? DEFAULT_SOURCE,
} = {}) {
  if (!existsSync(source)) return { action: 'missing-source', source };
  const target = join(home, 'profile-data/tavern/data/tools/mvu-api-test');
  if (existsSync(target)) {
    const stat = await lstat(target);
    if (!stat.isDirectory()) return { action: 'occupied', target };
    const entries = await readdir(target);
    if (entries.length === 0) {
      await copyBundle(source, target);
      return { action: 'seeded', target };
    }
    const state = await patchAllState(target);
    if (state === 'upstream') {
      await copyManaged(source, target, { overwrite: true });
      return { action: 'migrated', target };
    }
    if (state === 'managed') {
      await copyManaged(source, target, { overwrite: true });
      return { action: 'refreshed', target };
    }
    if (state === 'missing') {
      await copyManaged(source, target, { overwrite: false });
      return { action: 'seeded-missing', target };
    }
    return { action: 'unchanged', target };
  }
  await copyBundle(source, target);
  return { action: 'seeded', target };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const profile = process.env.DSH_PROFILE ?? 'web';
  if (profile !== 'tavern') process.exit(0);
  try {
    const result = await seedTavernTools();
    if (result.action === 'seeded') console.error(`tavern: seeded wrongbook host-patch tools at ${result.target}`);
    else if (result.action === 'migrated') console.error(`tavern: migrated upstream wrongbook host-patch tools at ${result.target}`);
    else if (result.action === 'refreshed') console.error(`tavern: refreshed image-managed wrongbook host-patch tools at ${result.target}`);
    else if (result.action === 'seeded-missing') console.error(`tavern: added missing wrongbook host-patch tools at ${result.target}`);
    else if (result.action === 'missing-source') console.warn(`tavern: host-patch tool source is missing: ${result.source}`);
    else if (result.action === 'occupied') console.warn(`tavern: host-patch tool path is not a directory: ${result.target}`);
  } catch (error) {
    // A diagnostic tool must not block startup; wrongbook reports the missing
    // file itself if seeding fails.
    console.warn(`tavern: host-patch tool seed failed: ${error?.message ?? error}`);
  }
}
