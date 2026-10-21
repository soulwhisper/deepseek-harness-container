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
import { patchRoutes } from '../patches/tavern/patch-tavern.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeManifest = join(root, 'package.json');
const base = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@soulwhisper/dsh-sso'];
const makeManifest = () => ({
  name: 'dsh-profile-web', private: true, packageManager: 'pnpm@11.25.0',
  dependencies: Object.fromEntries([...base, 'dshmarket'].map(name => [name, `link:/opt/dsh/runtime/node_modules/${name}`])),
  dsh: { profile: { bundles: [...base, 'dshmarket'] } },
});
const makeWorkspace = () => ({
  packages: ['.'], nodeLinker: 'hoisted', autoInstallPeers: false,
  allowBuilds: { 'node-pty': false },
  overrides: { '@soulwhisper/dsh-sso': 'link:/opt/dsh/runtime/node_modules/@soulwhisper/dsh-sso' },
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
  const path = join(options.home, 'profiles/web/node_modules/@soulwhisper/dsh-sso');
  await rm(path);
  await symlink('../../../../runtime/node_modules/@soulwhisper/dsh-sso', path);
  assert.equal((await materializeState(options)).action, 'unchanged');
  assert.equal(await readlink(path), '/opt/dsh/runtime/node_modules/@soulwhisper/dsh-sso');
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
  assert.equal(await readlink(join(profile, 'node_modules/@soulwhisper/dsh-sso')), '/opt/dsh/runtime/node_modules/@soulwhisper/dsh-sso');
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

test('a writable package directory cannot shadow protected immutable SSO after seeding', async t => {
  const options = await fixture(t);
  await materializeState(options);
  const packagePath = join(options.home, 'profiles/web/node_modules/@soulwhisper/dsh-sso');
  await rm(packagePath);
  await mkdir(packagePath);
  await writeFile(join(packagePath, 'index.mjs'), 'untrusted-shadow');
  await assert.rejects(materializeState(options), /Managed package was shadowed/);
  assert.equal(await readFile(join(packagePath, 'index.mjs'), 'utf8'), 'untrusted-shadow');
  assert.equal((await materializeState({ ...options, action: 'apply' })).action, 'migrated');
  assert.equal(await readlink(packagePath), '/opt/dsh/runtime/node_modules/@soulwhisper/dsh-sso');
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

