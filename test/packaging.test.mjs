import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, readlink, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { materializeState, mergeManifest, mergeLock, migrateOverlay } from '../scripts/materialize-state.mjs';
import { normalizeLockText, relativeLinkCount } from '../scripts/normalize-locks.mjs';
import { stableImmutableTarget } from '../scripts/finalize-profile.mjs';
import { patchRoutes, verifyTheme } from '../patches/tavern/patch-tavern.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeManifest = join(root, 'package.json');
const base = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@soulwhisper/dsh-forward-auth'];
const makeManifest = () => ({
  name: 'dsh-profile-web', private: true, packageManager: 'pnpm@11.25.0',
  dependencies: Object.fromEntries([...base, 'dshmarket'].map(name => [name, `link:/opt/dsh/runtime/node_modules/${name}`])),
  dsh: { profile: { bundles: [...base, 'dshmarket'] } },
});
const makeWorkspace = () => ({
  packages: ['.'], nodeLinker: 'hoisted', autoInstallPeers: false,
  allowBuilds: { 'node-pty': false },
  overrides: { '@soulwhisper/dsh-forward-auth': 'link:/opt/dsh/runtime/node_modules/@soulwhisper/dsh-forward-auth' },
});
const makeLock = () => ({ lockfileVersion: '9.0', settings: { autoInstallPeers: false }, importers: { '.': { dependencies: Object.fromEntries(Object.entries(makeManifest().dependencies).map(([name, specifier]) => [name, { specifier, version: specifier }])) } }, packages: {}, snapshots: {} });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-packaging-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'dsh');
  const seed = join(dir, 'seed');
  const profile = join(seed, 'profiles/web');
  await mkdir(profile, { recursive: true });
  await writeFile(join(seed, 'BUNDLED_VERSIONS'), JSON.stringify({ distribution: 'test-r1' }));
  await writeFile(join(profile, 'package.json'), JSON.stringify(makeManifest()));
  await writeFile(join(profile, 'pnpm-lock.yaml'), YAML.stringify(makeLock()));
  await writeFile(join(profile, 'pnpm-workspace.yaml'), YAML.stringify(makeWorkspace()));
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n');
  for (const name of Object.keys(makeManifest().dependencies)) {
    await mkdir(join(profile, 'node_modules', name), { recursive: true });
    await writeFile(join(profile, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
  }
  return { dir, home, seed, profile: 'web', legacy: join(dir, 'absent-legacy'), runtimeManifest };
}

test('new state is seeded once, then user mutations remain untouched', async t => {
  const options = await fixture(t);
  assert.equal((await materializeState(options)).action, 'seeded');
  const patch = join(options.home, 'profiles/web/cordis.patch.yml');
  await writeFile(patch, '- id: user\n  config: {keep: true}\n');
  const before = await readFile(patch, 'utf8');
  assert.equal((await materializeState(options)).action, 'unchanged');
  assert.equal(await readFile(patch, 'utf8'), before);
});

test('injected config mounts do not block the initial seed', async t => {
  const options = await fixture(t);
  const skill = join(options.home, 'skills', 'demo', 'SKILL.md');
  const patch = join(options.home, 'cordis.patch.yml');
  await mkdir(join(options.home, 'skills', 'demo'), { recursive: true });
  await writeFile(skill, '---\nname: demo\ndescription: fixture\n---\n');
  await writeFile(patch, '- id: injected\n  config: {keep: true}\n');
  assert.equal((await materializeState(options)).action, 'seeded');
  assert.equal(await readFile(skill, 'utf8'), '---\nname: demo\ndescription: fixture\n---\n');
  assert.equal(await readFile(patch, 'utf8'), '- id: injected\n  config: {keep: true}\n');
  assert.equal(await readFile(join(options.home, 'BUNDLED_VERSIONS'), 'utf8'),
    await readFile(join(options.seed, 'BUNDLED_VERSIONS'), 'utf8'));
  assert.equal((await lstat(join(options.home, '.distribution-state.json'))).isFile(), true);
});

test('durable state without a marker still refuses even with injected mounts', async t => {
  const options = await fixture(t);
  await mkdir(join(options.home, 'profiles/web'), { recursive: true });
  await writeFile(join(options.home, 'profiles/web/package.json'), '{"private":true}\n');
  await mkdir(join(options.home, 'skills', 'demo'), { recursive: true });
  await writeFile(join(options.home, 'skills', 'demo', 'SKILL.md'), 'fixture\n');
  await assert.rejects(materializeState(options), /explicit migration/);
  assert.equal(await readFile(join(options.home, 'profiles/web/package.json'), 'utf8'), '{"private":true}\n');
});

test('a version file alone is not proof of seeded state', async t => {
  const options = await fixture(t);
  await mkdir(options.home, { recursive: true });
  await writeFile(join(options.home, 'BUNDLED_VERSIONS'), await readFile(join(options.seed, 'BUNDLED_VERSIONS'), 'utf8'));
  await assert.rejects(materializeState(options), /explicit migration/);
});

test('a matching marker restores a missing image-owned version file', async t => {
  const options = await fixture(t);
  await materializeState(options);
  await rm(join(options.home, 'BUNDLED_VERSIONS'));
  assert.equal((await materializeState(options)).action, 'unchanged');
  assert.equal(await readFile(join(options.home, 'BUNDLED_VERSIONS'), 'utf8'),
    await readFile(join(options.seed, 'BUNDLED_VERSIONS'), 'utf8'));
});

test('a missing seed version file fails closed', async t => {
  const options = await fixture(t);
  await rm(join(options.seed, 'BUNDLED_VERSIONS'));
  await assert.rejects(materializeState(options));
  await assert.rejects(lstat(join(options.home, '.distribution-state.json')), { code: 'ENOENT' });
});

test('seed lock relative link versions are anchored to the immutable runtime', async t => {
  const options = await fixture(t);
  const seedLockPath = join(options.seed, 'profiles/web/pnpm-lock.yaml');
  const original = await readFile(seedLockPath, 'utf8');
  const relative = original.replace('version: link:/opt/dsh/runtime/node_modules/@deepseek-ai/dsh-base',
    'version: link:../../../dsh/runtime/node_modules/@deepseek-ai/dsh-base');
  assert.notEqual(relative, original);
  assert.equal(relativeLinkCount(relative), 1);
  await writeFile(seedLockPath, relative);
  await materializeState(options);
  const installed = await readFile(join(options.home, 'profiles/web/pnpm-lock.yaml'), 'utf8');
  assert.equal(relativeLinkCount(installed), 0);
  assert.match(installed, /version: link:\/opt\/dsh\/runtime\/node_modules\/@deepseek-ai\/dsh-base/u);
  assert.equal(normalizeLockText(installed), installed);
});

test('a dangling managed link is restored; a real directory is still refused', async t => {
  const options = await fixture(t);
  await materializeState(options);
  const path = join(options.home, 'profiles/web/node_modules/@soulwhisper/dsh-forward-auth');
  await rm(path);
  await symlink('../../../../runtime/node_modules/@soulwhisper/dsh-forward-auth', path);
  assert.equal((await materializeState(options)).action, 'unchanged');
  assert.equal(await readlink(path), '/opt/dsh/runtime/node_modules/@soulwhisper/dsh-forward-auth');
});

test('registry dependencies stay in the writable profile and resolve override links there', async t => {
  const options = await fixture(t);
  const manifest = makeManifest();
  manifest.dependencies['external-plugin'] = '1.0.0';
  await writeFile(join(options.seed, 'profiles/web/package.json'), JSON.stringify(manifest));
  await mkdir(join(options.seed, 'profiles/web/node_modules/external-plugin'), { recursive: true });
  await writeFile(join(options.seed, 'profiles/web/node_modules/external-plugin/package.json'),
    JSON.stringify({ name: 'external-plugin', version: '1.0.0' }));
  await materializeState(options);
  const installed = join(options.home, 'profiles/web/node_modules/external-plugin');
  assert.equal((await lstat(installed)).isSymbolicLink(), false);
  assert.equal(JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')).version, '1.0.0');
});

test('existing home refuses implicit migration without altering data', async t => {
  const options = await fixture(t);
  await mkdir(options.home);
  await writeFile(join(options.home, '.credentials.yaml'), 'secret-test-fixture');
  await assert.rejects(materializeState(options), /explicit migration/);
  assert.equal(await readFile(join(options.home, '.credentials.yaml'), 'utf8'), 'secret-test-fixture');
  assert.deepEqual(await readdir(options.home), ['.credentials.yaml']);
});

test('explicit migration preserves user graph, credentials and workspace, removes only obsolete auth', async t => {
  const options = await fixture(t);
  const profile = join(options.home, 'profiles/web');
  await mkdir(join(profile, 'node_modules/user-plugin'), { recursive: true });
  await mkdir(join(profile, 'node_modules/dsh-ui-auth'), { recursive: true });
  await writeFile(join(profile, 'node_modules/user-plugin/index.js'), 'user-owned-code');
  await writeFile(join(options.home, '.credentials.yaml'), 'credentials-must-survive', { mode: 0o640 });
  const workspace = join(options.dir, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'project.txt'), 'durable-project');
  const previous = {
    name: 'dsh-profile-web', dependencies: { 'user-plugin': '2.3.4', 'dsh-ui-auth': '0.7.1' },
    dsh: { profile: { bundles: ['user-plugin', 'dsh-ui-auth'] } },
    pnpm: { overrides: { 'user-transitive': '1.2.3' } },
  };
  await writeFile(join(profile, 'package.json'), JSON.stringify(previous));
  const lock = makeLock();
  lock.importers['.'].dependencies = { 'user-plugin': { specifier: '2.3.4', version: '2.3.4' }, 'dsh-ui-auth': { specifier: '0.7.1', version: '0.7.1' } };
  lock.packages = { 'user-plugin@2.3.4': { resolution: { integrity: 'sha512-test-fixture' } }, 'dsh-ui-auth@0.7.1': {} };
  lock.snapshots = { 'user-plugin@2.3.4': {}, 'dsh-ui-auth@0.7.1': {} };
  await writeFile(join(profile, 'pnpm-lock.yaml'), YAML.stringify(lock));
  await writeFile(join(profile, 'cordis.patch.yml'), '- name: dsh-ui-auth\n  id: legacy-auth\n- id: user\n  config: {path: /home/node/.dsh/profile-data/web}\n');
  await writeFile(join(options.home, 'cordis.patch.yml'), '- id: group\n  name: group\n  children:\n    - name: dsh-ui-auth\n    - name: user-plugin\n');
  const result = await materializeState({ ...options, action: 'apply' });
  assert.equal(result.action, 'migrated');
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies['user-plugin'], '2.3.4');
  assert.equal(manifest.dependencies['dsh-ui-auth'], undefined);
  assert.equal(manifest.pnpm.overrides['user-transitive'], '1.2.3');
  assert.deepEqual(manifest.dsh.profile.bundles, [...makeManifest().dsh.profile.bundles, 'user-plugin']);
  assert.equal(await readFile(join(profile, 'node_modules/user-plugin/index.js'), 'utf8'), 'user-owned-code');
  assert.equal(await readlink(join(profile, 'node_modules/@soulwhisper/dsh-forward-auth')), '/opt/dsh/runtime/node_modules/@soulwhisper/dsh-forward-auth');
  await assert.rejects(lstat(join(profile, 'node_modules/dsh-ui-auth')), { code: 'ENOENT' });
  assert.equal(await readFile(join(options.home, '.credentials.yaml'), 'utf8'), 'credentials-must-survive');
  assert.equal((await lstat(join(options.home, '.credentials.yaml'))).mode & 0o777, 0o600);
  assert.equal(await readFile(join(workspace, 'project.txt'), 'utf8'), 'durable-project');
  assert.equal(await readFile(join(result.backup, 'home/.credentials.yaml'), 'utf8'), 'credentials-must-survive');
  const migratedLock = YAML.parse(await readFile(join(profile, 'pnpm-lock.yaml'), 'utf8'));
  assert.deepEqual(migratedLock.packages['user-plugin@2.3.4'], lock.packages['user-plugin@2.3.4']);
  assert.equal(migratedLock.packages['dsh-ui-auth@0.7.1'], undefined);
  const overlay = YAML.parse(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'));
  assert.deepEqual(overlay, [{ id: 'user', config: { path: join(options.home, 'profile-data/web') } }]);
  assert.deepEqual(YAML.parse(await readFile(join(options.home, 'cordis.patch.yml'), 'utf8'))[0].children, [{ name: 'user-plugin' }]);
});

test('migration rollback lives outside state and excludes cache/logs', async t => {
  const options = await fixture(t);
  await materializeState(options);
  await mkdir(join(options.home, 'cache', 'attachments'), { recursive: true });
  await writeFile(join(options.home, 'cache', 'attachments', 'thumbnail'), 'cache-only');
  await mkdir(join(options.home, 'logs'), { recursive: true });
  await writeFile(join(options.home, 'logs', 'startup.log'), 'log-only');
  await writeFile(join(options.home, '.credentials.yaml'), 'rollback-credential', { mode: 0o600 });
  await writeFile(join(options.home, '.distribution-state.json'), JSON.stringify({ schema: 1, distribution: 'old', profile: 'web' }));
  const backupRoot = join(options.dir, 'rollback');
  const result = await materializeState({ ...options, action: 'apply', backupRoot });
  assert.equal(result.action, 'migrated');
  assert.ok(result.backup.startsWith(`${backupRoot}/`));
  await assert.rejects(lstat(join(result.backup, 'home/cache')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(result.backup, 'home/logs')), { code: 'ENOENT' });
  assert.equal(await readFile(join(result.backup, 'home/.credentials.yaml'), 'utf8'), 'rollback-credential');
});

test('rollback root cannot live inside DSH_HOME', async t => {
  const options = await fixture(t);
  await materializeState(options);
  await writeFile(join(options.home, '.distribution-state.json'), JSON.stringify({ schema: 1, distribution: 'old', profile: 'web' }));
  await assert.rejects(materializeState({ ...options, action: 'apply', backupRoot: join(options.home, 'rollback') }),
    /outside DSH_HOME/);
});

test('a stale migration lock fails closed without touching state', async t => {
  const options = await fixture(t);
  await materializeState(options);
  await writeFile(join(options.home, '.distribution-state.json'), JSON.stringify({ schema: 1, distribution: 'old', profile: 'web' }));
  await mkdir(join(options.home, '.distribution-migration-lock'));
  await assert.rejects(materializeState({ ...options, action: 'apply' }), /Migration lock already exists/);
  assert.match(await readFile(join(options.home, '.distribution-state.json'), 'utf8'), /old/u);
});

test('legacy-home import is explicit, non-destructive and preserves credentials', async t => {
  const options = await fixture(t);
  const legacy = join(options.dir, 'legacy');
  await mkdir(legacy);
  await writeFile(join(legacy, '.credentials.yaml'), 'legacy-credential');
  await assert.rejects(materializeState({ ...options, legacy }), /Legacy/);
  const result = await materializeState({ ...options, legacy, action: 'apply' });
  assert.equal(result.action, 'migrated');
  assert.equal(await readFile(join(legacy, '.credentials.yaml'), 'utf8'), 'legacy-credential');
  assert.equal(await readFile(join(options.home, '.credentials.yaml'), 'utf8'), 'legacy-credential');
});

test('a writable package directory cannot shadow protected immutable forward-auth after seeding', async t => {
  const options = await fixture(t);
  await materializeState(options);
  const packagePath = join(options.home, 'profiles/web/node_modules/@soulwhisper/dsh-forward-auth');
  await rm(packagePath);
  await mkdir(packagePath);
  await writeFile(join(packagePath, 'index.mjs'), 'untrusted-shadow');
  await assert.rejects(materializeState(options), /Managed package was shadowed/);
  assert.equal(await readFile(join(packagePath, 'index.mjs'), 'utf8'), 'untrusted-shadow');
  assert.equal((await materializeState({ ...options, action: 'apply' })).action, 'migrated');
  assert.equal(await readlink(packagePath), '/opt/dsh/runtime/node_modules/@soulwhisper/dsh-forward-auth');
});

test('rollback and future schemas never silently overwrite newer state', async t => {
  const options = await fixture(t);
  await materializeState(options);
  const marker = join(options.home, '.distribution-state.json');
  await writeFile(marker, JSON.stringify({ schema: 2, distribution: 'future', profile: 'web' }));
  await assert.rejects(materializeState({ ...options, action: 'apply' }), /Newer state schema/);
  await writeFile(marker, JSON.stringify({ schema: 1, distribution: 'future', profile: 'web' }));
  await assert.rejects(materializeState(options), /Rollback requires restoring/);
});

test('seed links keep the stable runtime alias and reject escapes', () => {
  assert.equal(stableImmutableTarget('/opt/dsh-seed/profiles/web/node_modules/pkg',
    '/opt/dsh/docker/runtime/node_modules/pkg'), '/opt/dsh/runtime/node_modules/pkg');
  assert.equal(stableImmutableTarget('/opt/dsh-seed/profiles/web/node_modules/pkg',
    '/opt/dsh/runtime/node_modules/pkg'), '/opt/dsh/runtime/node_modules/pkg');
  assert.throws(() => stableImmutableTarget('/opt/dsh-seed/profiles/web/node_modules/pkg', '/etc/passwd'),
    /escapes immutable source tree/);
});

test('theme patch verifies exact package and file hashes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-theme-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'lib'), { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-theme', version: '0.2.1-rc.2' }));
  await writeFile(join(directory, 'lib/index.js'), 'index');
  await writeFile(join(directory, 'lib/client.js'), 'client');
  const expected = {
    package: '@deepseek-ai/dsh-client-ui-theme', version: '0.2.1-rc.2',
    indexSha256: createHash('sha256').update('index').digest('hex'),
    clientSha256: createHash('sha256').update('client').digest('hex'),
  };
  await verifyTheme(directory, expected);
  await assert.rejects(verifyTheme(directory, { ...expected, clientSha256: '0'.repeat(64) }), /theme source mismatch/);
});

test('migration retains Tavern user metadata but updates managed absolute data root', () => {
  const seed = makeManifest();
  seed.dshTavern = { source: '/opt/dsh-tavern/apps/dsh-tavern', dataRoot: '/data/dsh/profile-data/tavern/data', managedBundles: base };
  const result = mergeManifest({ dshTavern: { userPreference: 42, dataRoot: '/home/node/.dsh/profile-data/tavern/data' }, dependencies: { 'some-user-package': '3.0.0', '@deepseek-ai/user-added-optional-bundle': '0.2.1-rc.2' } }, seed, '/custom/dsh', 'tavern');
  assert.equal(result.dshTavern.userPreference, 42);
  assert.equal(result.dshTavern.dataRoot, '/custom/dsh/profile-data/tavern/data');
  assert.equal(result.dependencies['some-user-package'], '3.0.0');
  assert.equal(result.dependencies['@deepseek-ai/user-added-optional-bundle'], '0.2.1-rc.2');
  assert.deepEqual(migrateOverlay([{ id: 'user', config: { opaque: 'dsh-ui-auth is merely a comment' } }], '/data/dsh'), [{ id: 'user', config: { opaque: 'dsh-ui-auth is merely a comment' } }]);
  assert.throws(() => mergeLock({ lockfileVersion: '6.0' }, makeLock()), /lock format changed/);
});

const routeFixture = `
        const origin = req.headers.origin
        if (req.path === '/capability') return 'capability'
        const readsStaticAsset = req.path === '/static'
        const localOrOpaqueOrigin = !origin || origin === 'null'
        if (readsStaticAsset && !localOrOpaqueOrigin) { return 'forbidden' }
        const readsCachedAsset = false, readsOfficialMvu = false, readsFullTemplate = false, readsRuntimeAsset = false, readsClientAsset = false, readsPluginAsset = false, sceneSameOrigin = false
        if (!readsCachedAsset && !readsStaticAsset && !readsOfficialMvu && !readsFullTemplate && !readsRuntimeAsset && !readsClientAsset && !readsPluginAsset && !sceneSameOrigin && typeof origin === 'string' && origin !== '' && !/^https?:\\/\\/(127\\.0\\.0\\.1|localhost)(:\\d+)?$/.test(origin)) { return 'forbidden' }
        return 'allowed'
`;

test('exact-hash Tavern patch accepts configured public Origin, rejects cross-Origin and preserves capability routing', () => {
  const hash = createHash('sha256').update(routeFixture).digest('hex');
  assert.throws(() => patchRoutes(routeFixture, 'not-the-hash'), /source mismatch/);
  const route = new Function('req', 'process', patchRoutes(routeFixture, hash));
  const env = { env: { DSH_PUBLIC_URL: 'https://tavern.example.test/' } };
  const req = (origin, host = 'tavern.example.test', path = '/cards') => ({ path, headers: { origin, host } });
  assert.equal(route(req('https://tavern.example.test'), env), 'allowed');
  assert.equal(route(req('https://tavern.example.test', 'tavern.example.test', '/static'), env), 'allowed');
  assert.equal(route(req('https://evil.example.test'), env), 'forbidden');
  assert.equal(route(req('https://tavern.example.test', 'attacker.example.test'), env), 'forbidden');
  assert.equal(route({ path: '/cards', headers: { origin: 'https://tavern.example.test', host: 'tavern.example.test', 'sec-fetch-site': 'cross-site' } }, env), 'forbidden');
  assert.equal(route(req('https://evil.example.test', 'tavern.example.test', '/capability'), env), 'capability');
  assert.equal(route(req('https://tavern.example.test'), { env: {} }), 'forbidden');
});

