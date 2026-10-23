import { cp, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// dsh-tavern-wrongbook expects its host-patch runner under
// <tavern data>/tools/mvu-api-test/. The image applies the supported patches
// at build time; this seed gives the plugin's status panel the same scripts.
// First boot only: an existing user-managed copy is never overwritten.
const DEFAULT_SOURCE = '/opt/dsh/seed/tavern-tools/mvu-api-test';

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
    if (entries.length > 0) return { action: 'unchanged', target };
    await rm(target, { recursive: true, force: true });
  }
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  return { action: 'seeded', target };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const profile = process.env.DSH_PROFILE ?? 'web';
  if (profile !== 'tavern') process.exit(0);
  try {
    const result = await seedTavernTools();
    if (result.action === 'seeded') console.error(`tavern: seeded wrongbook host-patch tools at ${result.target}`);
    else if (result.action === 'missing-source') console.warn(`tavern: host-patch tool source is missing: ${result.source}`);
    else if (result.action === 'occupied') console.warn(`tavern: host-patch tool path is not a directory: ${result.target}`);
  } catch (error) {
    // A diagnostic tool must not block startup; wrongbook reports the missing
    // file itself if seeding fails.
    console.warn(`tavern: host-patch tool seed failed: ${error?.message ?? error}`);
  }
}
