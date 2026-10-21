import { cp, mkdir, readdir, readFile, writeFile, rename, rm, lstat, symlink, chmod, readlink, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { normalizeLockLinks, normalizeLockText } from './normalize-locks.mjs';

const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const json = async path => JSON.parse(await readFile(path, 'utf8'));
async function normalizeLockFile(path) {
  if (!await exists(path)) return;
  const text = await readFile(path, 'utf8');
  const normalized = normalizeLockText(text);
  if (normalized !== text) await writeFile(path, normalized);
}
const obsolete = name => name === 'dsh-ui-auth' || name.startsWith('dsh-ui-auth/');
// Deployment-injected configuration may exist before the first boot. It is
// not durable DSH state and must not make an empty home look migrated.
const INJECTED_HOME_ENTRIES = new Set(['cordis.patch.yml', 'skills']);
const stateEntries = entries => entries.filter(name => !INJECTED_HOME_ENTRIES.has(name));
// Bundled skills are recommendations, not enforced runtime content. Copy only
// missing top-level bundles so an injected or user-edited skill wins.
async function seedSkills(seed, home) {
  const source = join(seed, 'skills');
  if (!await exists(source)) return;
  const target = join(home, 'skills');
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const destination = join(target, entry.name);
    if (await exists(destination)) continue;
    await cp(join(source, entry.name), destination, { recursive: entry.isDirectory(), verbatimSymlinks: true });
  }
}
const managed = (name, seed, workspace = {}) => name === '@soulwhisper/dsh-forward-auth'
  || Object.hasOwn(workspace.overrides ?? seed.pnpm?.overrides ?? {}, name)
  || Object.hasOwn(seed.dependencies ?? {}, name);

export function migrateOverlay(value, home) {
  if (Array.isArray(value)) return value.filter(row => !(row && typeof row === 'object' && typeof row.name === 'string' && obsolete(row.name))).map(row => migrateOverlay(row, home));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([name]) => !obsolete(name)).map(([key, item]) => [key, migrateOverlay(item, home)]));
  if (typeof value === 'string' && (value === '/home/node/.dsh' || value.startsWith('/home/node/.dsh/'))) return home + value.slice('/home/node/.dsh'.length);
  return value;
}

function immutableEntries(seed, source, workspace = {}) {
  // Registry/git dependencies stay as writable profile copies so their own
  // dependency lookup reaches the profile's override links. Only absolute
  // link dependencies belong to the immutable image tree.
  const entries = new Map();
  for (const [name, spec] of Object.entries(seed.dependencies ?? {})) {
    if (typeof spec === 'string' && /^(?:link|file):\//u.test(spec)) entries.set(name, join(source, 'node_modules', name));
  }
  for (const [name, spec] of Object.entries(workspace.overrides ?? seed.pnpm?.overrides ?? {})) {
    if (typeof spec !== 'string' || !spec.startsWith('link:/opt/dsh/runtime/node_modules/')) throw new Error(`Invalid immutable override: ${name}`);
    entries.set(name, spec.slice('link:'.length));
  }
  // Tavern's pinned ecosystem is part of the immutable seed, unlike Web's
  // floating plugins. Link every managed dependency from the seed and restore
  // it if a manager or manual edit removes the active profile entry.
  for (const name of seed.dshTavern?.managedDependencies ?? []) {
    if (!entries.has(name)) entries.set(name, join(source, 'node_modules', name));
  }
  return entries;
}

async function managedLinks(target, source, seed, install, workspace = {}) {
  const modules = join(target, 'node_modules');
  if (install) await mkdir(modules, { recursive: true });
  if (!(await lstat(modules)).isDirectory()) throw new Error('Profile node_modules must be a real writable directory');
  for (const [name, expected] of immutableEntries(seed, source, workspace)) {
    const destination = join(modules, name);
    if (install) {
      await mkdir(dirname(destination), { recursive: true });
      if (!(await lstat(dirname(destination))).isDirectory()) throw new Error(`Managed scope is not a real directory: ${name}`);
      await rm(destination, { recursive: true, force: true });
      await symlink(expected, destination);
    } else {
      let info;
      try {
        info = await lstat(destination);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await mkdir(dirname(destination), { recursive: true });
        if (!(await lstat(dirname(destination))).isDirectory()) throw new Error(`Managed scope is not a real directory: ${name}`);
        await symlink(expected, destination);
        continue;
      }
      if (!info.isSymbolicLink()) throw new Error(`Managed package was shadowed: ${name}; restore immutable links with an explicit state migration`);
      const recorded = await readlink(destination);
      // Exact immutable paths are valid even when a test fixture has no /opt/dsh.
      if (recorded !== expected) {
        let resolved;
        try { resolved = await realpath(destination); } catch (error) {
          if (!['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error.code)) throw error;
        }
        if (resolved === undefined) {
          // pnpm may rewrite an absolute link: version relative to the old
          // seed path. A dangling symlink cannot execute; restore the
          // immutable target instead of refusing an otherwise valid profile.
          await rm(destination, { force: true });
          await symlink(expected, destination);
        } else if (resolved !== await realpath(expected)) {
          throw new Error(`Managed package was shadowed: ${name}; restore immutable links with an explicit state migration`);
        }
      }
    }
  }
}

export function mergeManifest(previous, seed, home, profile, workspace = {}) {
  const next = structuredClone(previous);
  for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (!next[kind]) continue;
    for (const name of Object.keys(next[kind])) if (managed(name, seed, workspace) || obsolete(name)) delete next[kind][name];
  }
  next.dependencies = { ...next.dependencies, ...seed.dependencies };
  const oldBundles = next.dsh?.profile?.bundles ?? [];
  next.dsh = { ...next.dsh, profile: { ...next.dsh?.profile, bundles: [...new Set([...seed.dsh.profile.bundles, ...oldBundles.filter(name => !obsolete(name) && !managed(name, seed, workspace))])] } };
  next.packageManager = seed.packageManager;
  if (next.pnpm?.overrides) {
    for (const name of Object.keys(next.pnpm.overrides)) if (managed(name, seed, workspace) || obsolete(name)) delete next.pnpm.overrides[name];
    if (Object.keys(next.pnpm.overrides).length === 0) delete next.pnpm.overrides;
  }
  if (next.pnpm && Object.keys(next.pnpm).length === 0) delete next.pnpm;
  if (profile === 'tavern') next.dshTavern = { ...next.dshTavern, ...seed.dshTavern, dataRoot: join(home, 'profile-data/tavern/data') };
  return next;
}

export function mergeLock(previous, seed, workspace = {}) {
  if (String(previous.lockfileVersion) !== String(seed.lockfileVersion)) throw new Error('Profile lock format changed: migrate its pnpm lock offline before adopting this image');
  const merged = { ...previous, settings: seed.settings, overrides: { ...previous.overrides, ...seed.overrides }, packages: { ...previous.packages, ...seed.packages }, snapshots: { ...previous.snapshots, ...seed.snapshots } };
  const oldImporter = previous.importers?.['.'] ?? {};
  const newImporter = seed.importers?.['.'] ?? {};
  const importer = { ...oldImporter };
  for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    importer[kind] = { ...oldImporter[kind] };
    for (const name of Object.keys(importer[kind])) if (managed(name, seed, workspace) || obsolete(name) || Object.hasOwn(newImporter.dependencies ?? {}, name)) delete importer[kind][name];
    Object.assign(importer[kind], newImporter[kind]);
  }
  merged.importers = { ...previous.importers, '.': importer };
  for (const section of ['packages', 'snapshots']) for (const name of Object.keys(merged[section])) if (/^dsh-ui-auth(?:@|\/)/.test(name)) delete merged[section][name];
  return merged;
}

export async function materializeState(options = {}) {
  const home = resolve(options.home ?? process.env.DSH_HOME ?? '/data/dsh');
  const seed = resolve(options.seed ?? '/opt/dsh/seed');
  const profile = options.profile ?? process.env.DSH_PROFILE ?? 'web';
  const action = options.action ?? process.env.DSH_STATE_MIGRATION ?? 'refuse';
  const legacy = resolve(options.legacy ?? process.env.DSH_LEGACY_HOME ?? '/home/node/.dsh');
  const backupRoot = resolve(options.backupRoot ?? process.env.DSH_BACKUP_ROOT ?? join(dirname(home), 'dsh-migrations'));
  if (backupRoot === home || backupRoot.startsWith(`${home}${sep}`)) {
    throw new Error('DSH_BACKUP_ROOT must be outside DSH_HOME; the rollback copy is not user state and must not be included in the state backup');
  }
  const require = createRequire(options.runtimeManifest ?? '/opt/dsh/runtime/package.json');
  const YAML = require('yaml');
  if (!['web', 'tavern'].includes(profile)) throw new Error('Unknown image profile');
  const bundled = await readFile(join(seed, 'BUNDLED_VERSIONS'), 'utf8');
  const identity = JSON.parse(bundled).distribution;
  const markerPath = join(home, '.distribution-state.json');
  await mkdir(home, { recursive: true, mode: 0o700 });
  let entries = await readdir(home);
  if (stateEntries(entries).length === 0 && legacy !== home && await exists(legacy) && (await readdir(legacy)).length) {
    if (action !== 'apply') throw new Error('Legacy /home/node/.dsh detected; snapshot it and set DSH_STATE_MIGRATION=apply to copy it without deleting the original');
    await cp(legacy, home, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
    entries = await readdir(home);
  }
  if (stateEntries(entries).length === 0) {
    const seedSkillsRoot = join(seed, 'skills');
    await cp(seed, home, {
      recursive: true,
      verbatimSymlinks: true,
      filter: path => path !== seedSkillsRoot && !path.startsWith(`${seedSkillsRoot}${sep}`),
    });
    await seedSkills(seed, home);
    await normalizeLockFile(join(home, 'profiles', profile, 'pnpm-lock.yaml'));
    const source = join(seed, 'profiles', profile);
    const seedManifest = await json(join(source, 'package.json'));
    const seedWorkspace = YAML.parse(await readFile(join(source, 'pnpm-workspace.yaml'), 'utf8'));
    await managedLinks(join(home, 'profiles', profile), source, seedManifest, true, seedWorkspace);
    await writeFile(markerPath, JSON.stringify({ schema: 1, distribution: identity, profile }, null, 2) + '\n', { mode: 0o600 });
    return { action: 'seeded' };
  }
  const marker = await exists(markerPath) ? await json(markerPath) : null;
  if (marker?.schema > 1) throw new Error('Newer state schema cannot be rolled back; restore the pre-upgrade volume snapshot');
  if (marker?.schema === 1 && marker.distribution === identity && marker.profile === profile) {
    const source = join(seed, 'profiles', profile);
    const target = join(home, 'profiles', profile);
    await normalizeLockFile(join(target, 'pnpm-lock.yaml'));
    try {
      const seedManifest = await json(join(source, 'package.json'));
      const seedWorkspace = YAML.parse(await readFile(join(source, 'pnpm-workspace.yaml'), 'utf8'));
      if (profile === 'tavern') {
        const manifestPath = join(target, 'package.json');
        if (await exists(manifestPath)) {
          const previous = await json(manifestPath);
          const restored = mergeManifest(previous, seedManifest, home, profile, seedWorkspace);
          if (JSON.stringify(restored) !== JSON.stringify(previous)) {
            await writeFile(manifestPath, `${JSON.stringify(restored, null, 2)}\n`);
          }
        }
      }
      await managedLinks(target, source, seedManifest, false, seedWorkspace);
      // The image-owned version file is not user state. Restore it without
      // re-seeding the profiles, credentials, sessions or workspace.
      if (!await exists(join(home, 'BUNDLED_VERSIONS'))) await cp(join(seed, 'BUNDLED_VERSIONS'), join(home, 'BUNDLED_VERSIONS'));
      return { action: 'unchanged' };
    } catch (error) {
      if (action !== 'apply') throw error;
    }
  }
  if (action !== 'apply') throw new Error(`Existing state requires explicit migration to ${identity}/${profile}. Snapshot /data and /workspace; set DSH_STATE_MIGRATION=apply once. Rollback requires restoring that snapshot, not merely an old image.`);
  const lock = join(home, '.distribution-migration-lock');
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Migration lock already exists at ${lock}; stop any migration process, verify no writer is active, back up /data and /workspace, then remove the lock explicitly`);
    }
    throw error;
  }
  let backup;
  try {
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    backup = join(backupRoot, `${Date.now()}-${process.pid}`);
    await mkdir(backup, { recursive: true, mode: 0o700 });
    // Cache and startup logs have dedicated volumes; never copy them into a
    // rollback archive or into the primary state backup.
    const excluded = new Set([lock, join(home, 'cache'), join(home, 'logs')]);
    await cp(home, join(backup, 'home'), { recursive: true, verbatimSymlinks: true, preserveTimestamps: true, filter: path => !excluded.has(path) });
    const target = join(home, 'profiles', profile);
    const source = join(seed, 'profiles', profile);
    await mkdir(target, { recursive: true });
    const seedManifest = await json(join(source, 'package.json'));
    const seedWorkspace = YAML.parse(await readFile(join(source, 'pnpm-workspace.yaml'), 'utf8'));
    const manifestPath = join(target, 'package.json');
    const previous = await exists(manifestPath) ? await json(manifestPath) : { name: `dsh-profile-${profile}`, private: true };
    const manifest = mergeManifest(previous, seedManifest, home, profile, seedWorkspace);
    const lockPath = join(target, 'pnpm-lock.yaml');
    const seedLock = normalizeLockLinks(YAML.parse(await readFile(join(source, 'pnpm-lock.yaml'), 'utf8')));
    if (await exists(lockPath)) {
      const previousLock = YAML.parse(await readFile(lockPath, 'utf8'));
      await writeFile(lockPath, YAML.stringify(normalizeLockLinks(mergeLock(previousLock, seedLock, seedWorkspace))));
    } else {
      const extras = Object.keys(previous.dependencies ?? {}).filter(name => !managed(name, seedManifest, seedWorkspace) && !obsolete(name));
      if (extras.length) throw new Error('User dependencies have no profile lock; generate their pnpm lock offline before migrating');
      await cp(join(source, 'pnpm-lock.yaml'), lockPath);
      await normalizeLockFile(lockPath);
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    const workspace = join(target, 'pnpm-workspace.yaml');
    const previousWorkspace = await exists(workspace) ? YAML.parse(await readFile(workspace, 'utf8')) : {};
    const previousOverrides = { ...previousWorkspace?.overrides };
    for (const name of Object.keys(previousOverrides)) if (obsolete(name) || Object.hasOwn(seedWorkspace.overrides ?? {}, name)) delete previousOverrides[name];
    await writeFile(workspace, YAML.stringify({
      ...previousWorkspace,
      ...seedWorkspace,
      allowBuilds: { ...previousWorkspace?.allowBuilds, ...seedWorkspace.allowBuilds },
      patchedDependencies: { ...previousWorkspace?.patchedDependencies, ...seedWorkspace.patchedDependencies },
      overrides: { ...previousOverrides, ...seedWorkspace.overrides },
    }));
    if (await exists(join(source, 'patches'))) await cp(join(source, 'patches'), join(target, 'patches'), { recursive: true });
    await managedLinks(target, source, seedManifest, true, seedWorkspace);
    await rm(join(target, 'node_modules/dsh-ui-auth'), { recursive: true, force: true });
    // A global overlay can also retain the obsolete auth plugin. Leave all
    // other rows/configuration and credential/account data in place.
    for (const overlay of [join(home, 'cordis.patch.yml'), join(target, 'cordis.patch.yml')]) {
      if (!await exists(overlay)) continue;
      await writeFile(overlay, YAML.stringify(migrateOverlay(YAML.parse(await readFile(overlay, 'utf8')), home)));
    }
    if (!await exists(join(target, 'cordis.patch.yml'))) await cp(join(source, 'cordis.patch.yml'), join(target, 'cordis.patch.yml'));
    await seedSkills(seed, home);
    if (await exists(join(home, '.credentials.yaml'))) await chmod(join(home, '.credentials.yaml'), 0o600);
    await writeFile(join(home, 'BUNDLED_VERSIONS'), bundled);
    const temporary = `${markerPath}.tmp`;
    await writeFile(temporary, JSON.stringify({ schema: 1, distribution: identity, profile, backup }, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, markerPath);
    return { action: 'migrated', backup };
  } catch (error) {
    throw new Error(`Migration failed; do not start DSH. Restore ${backup ?? 'the volume snapshot'} before retrying: ${error.message}`, { cause: error });
  } finally {
    await rm(lock, { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await materializeState();
  console.error(`state: ${result.action}${result.backup ? `; rollback copy: ${result.backup}` : ''}`);
}
