// Streamed into disposable final-image containers by smoke.mjs; not a fallback server.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { lstat, readFile, readlink, stat, cp, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const [mode, json = '{}'] = process.argv.slice(2);
const config = JSON.parse(json);
const forwardHeader = config.header ?? 'x-authentik-uid';
const runtimeRequire = createRequire('/opt/dsh/runtime/package.json');
let probeStage = 'start';
function check(condition, label) { assert.ok(condition, label); }
async function absent(path) {
  try { await lstat(path); return false; } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}
function request(path, headers = {}, method = 'GET', body, deadline = 10_000, bodyLimit = 64_000_000) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: config.host, port: config.port, path, method,
      headers: { Host: config.authority, Origin: `http://${config.authority}`, ...headers },
    }, res => {
      const chunks = [];
      let length = 0;
      res.on('data', chunk => {
        length += chunk.length;
        if (length > bodyLimit) req.destroy(new Error('body limit'));
        else chunks.push(chunk);
      });
      res.on('end', () => {
        finish();
        const bytes = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, text: bytes.toString('utf8'), bytes });
      });
      res.on('error', error => { finish(); reject(error); });
    });
    // req.setTimeout is an inactivity timeout; enforce the total wall-clock
    // deadline as well so a trickling response cannot keep the probe alive.
    const wallClock = setTimeout(() => req.destroy(new Error('HTTP deadline')), deadline);
    const finish = () => clearTimeout(wallClock);
    req.setTimeout(deadline, () => req.destroy(new Error('HTTP deadline')));
    req.on('error', error => { finish(); reject(error); });
    req.end(body);
  });
}
function websocket(headers) {
  const requireGateway = createRequire(runtimeRequire.resolve('@deepseek-ai/dsh-api-gateway'));
  const WebSocket = requireGateway('ws');
  return new WebSocket(`ws://${config.host}:${config.port}/api/remote.mux`, {
    headers: { Host: config.authority, Origin: `http://${config.authority}`, ...headers },
    handshakeTimeout: 10_000,
  });
}
async function deniedUpgrade(headers) {
  await new Promise((resolve, reject) => {
    const ws = websocket(headers);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('Upgrade rejection deadline')); }, 12_000);
    ws.on('error', () => {});
    ws.once('open', () => { clearTimeout(timer); ws.terminate(); reject(new Error('Unauthorized upgrade admitted')); });
    ws.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      response.resume();
      ws.terminate();
      if (response.statusCode === 403) resolve();
      else reject(new Error('Expected fail-closed upgrade status'));
    });
  });
}
async function rejection(headers) {
  for (const path of ['/', '/api/pluginInventory/list', '/api/remote.mux', '/?token=forged']) {
    const result = await request(path, headers);
    check(result.status === 403, 'Untrusted/missing/invalid identity must be forbidden');
    check(!result.headers['set-cookie'], 'Denied request must not mint a native cookie');
  }
  await deniedUpgrade(headers);
}
async function trusted() {
  probeStage = 'rejection-empty';
  await rejection({});
  probeStage = 'rejection-denied-subject';
  await rejection({ [forwardHeader]: 'not-allowed' });
  probeStage = 'rejection-duplicate-header';
  await rejection({ [forwardHeader]: [config.uid, config.uid] });
  probeStage = 'clean-root';
  const identity = { [forwardHeader]: config.uid };
  let page = await request('/', identity);
  let cookie = '';
  for (let redirects = 0; redirects < 5; redirects++) {
    const minted = page.headers['set-cookie'] ?? [];
    if (minted.length) {
      check(minted.some(value => /;\s*HttpOnly/iu.test(value) && /;\s*SameSite=Strict/iu.test(value)), 'Native cookie flags');
      cookie = minted.map(value => value.split(';', 1)[0]).join('; ');
    }
    if (page.status === 200) break;
    check([302, 303, 307, 308].includes(page.status), 'Trusted clean root must serve or redirect cleanly');
    const location = new URL(page.headers.location, `http://${config.authority}`);
    check(location.host === config.authority && !location.searchParams.has('token'), 'No public launch-token redirect');
    page = await request(`${location.pathname}${location.search}`, { ...identity, Cookie: cookie });
  }
  check(page.status === 200 && /<html/iu.test(page.text), 'Actual application HTML');
  check(cookie.length > 0, 'forward-auth clean root must issue a native browser cookie');
  check(!/[?&]token=/iu.test(page.text), 'No native launch token in app HTML');
  probeStage = 'cookie-replay';
  const headers = { ...identity, Cookie: cookie };
  const again = await request('/', headers);
  check(again.status === 200, 'Native cookie works with a verified edge identity');
  check((await request('/?token=upstream', identity)).status === 403, 'Upstream launch-token URL is rejected');
  await rejection({ Cookie: cookie });
  probeStage = 'origin-fence';
  const wrongOrigin = await request('/api/pluginInventory/list', { ...headers, Origin: 'http://evil.invalid' });
  check(wrongOrigin.status === 403, 'Native Origin fence must survive forward-auth exchange');
  const wrongHost = await request('/api/pluginInventory/list', { ...headers, Host: 'evil.invalid' });
  check(wrongHost.status === 403, 'Native Host fence must survive forward-auth exchange');
  probeStage = 'client-assets';
  const scripts = [...page.text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/giu)]
    .map(match => match[1].replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'"));
  check(scripts.length > 0, 'Real client script must be referenced');
  for (const source of scripts) {
    const url = new URL(source, `http://${config.authority}/`);
    check(url.host === config.authority, 'Client bootstrap must remain same-origin');
    const path = `${url.pathname}${url.search}`;
    const asset = await request(path, headers);
    check(asset.status === 200 && /(?:javascript|ecmascript)/iu.test(asset.headers['content-type'] ?? '')
      && asset.text.length > 100 && !/^\s*</u.test(asset.text), 'Actual client JavaScript, not index fallback');
    check((await request(path)).status === 403, 'Anonymous static assets denied');
  }
  probeStage = 'inventory-rpc';
  const inventory = await request('/api/pluginInventory/list', {
    ...headers, 'Content-Type': 'application/json',
  }, 'POST', JSON.stringify({ type: 'client-request', rpcId: 'smoke-inventory',
    method: 'pluginInventory/list', payload: { args: {} } }));
  check(inventory.status === 200, 'Native inventory RPC HTTP carrier');
  const response = JSON.parse(inventory.text);
  check(response.type === 'server-response' && response.result?.ok === true, 'Native inventory RPC result');
  if (process.env.DSH_PROFILE === 'tavern') {
    probeStage = 'source-route';
    check((await request('/distribution/source.tar.gz')).status === 403, 'Source route remains guarded');
    // The 3.2 corresponding-source archive is larger than the default probe
    // body limit; allow this one download while keeping other responses bounded.
    const source = await request('/distribution/source.tar.gz', headers, 'GET', undefined, 60_000, 256 * 1024 * 1024);
    const sourceHead = await request('/distribution/source.tar.gz', headers, 'HEAD');
    check(source.status === 200 && source.bytes[0] === 0x1f && source.bytes[1] === 0x8b
      && source.bytes.length > 1024 && /gzip/iu.test(source.headers['content-type'] ?? ''), 'Real source gzip download');
    check(sourceHead.status === 200 && Number(sourceHead.headers['content-length']) === source.bytes.length, 'Source HEAD length');
    check((await request('/distribution/source.tar.gz', headers, 'POST')).status === 405, 'Source route is read-only');
  }
  probeStage = 'websocket';
  await new Promise((resolve, reject) => {
    const ws = websocket(headers);
    const openedAt = Date.now();
    let ready = false;
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('Bound stream lifetime deadline')); }, 30_000);
    const fail = () => { clearTimeout(timer); ws.terminate(); reject(new Error('Native mux failed')); };
    ws.on('error', fail);
    ws.once('unexpected-response', (_request, res) => { res.resume(); fail(); });
    ws.once('open', () => ws.send(JSON.stringify({ type: 'open', streamId: 'smoke-events', endpoint: '$events', payload: { args: {} } })));
    ws.on('message', data => {
      try {
        const frame = JSON.parse(String(data));
        if (frame.type === 'error') { fail(); return; }
        if (frame.type === 'item' && frame.streamId === 'smoke-events' && frame.value?.type === 'ready') {
          check(typeof frame.value.clientId === 'string' && frame.value.clientId.length > 0, 'Actual $events ready identity');
          ready = true;
        }
      } catch { fail(); }
    });
    ws.once('close', () => {
      clearTimeout(timer);
      if (ready && Date.now() - openedAt >= 18_000) resolve();
      else reject(new Error('Mux closed before native readiness or configured lifetime'));
    });
  });
}
async function manager() {
  const identity = { [forwardHeader]: config.uid };
  const index = await request('/', identity);
  check(index.status === 200, 'Manager clean index admission');
  const cookie = (index.headers['set-cookie'] ?? []).map(value => value.split(';', 1)[0]).join('; ');
  const headers = { ...identity, Cookie: cookie, 'Content-Type': 'application/json' };
  let correlation = 0;
  const rpc = async (method, args) => {
    const result = await request(`/api/pluginManager/${method}`, headers, 'POST', JSON.stringify({
      type: 'client-request', rpcId: `smoke-manager-${++correlation}`,
      method: `pluginManager/${method}`, payload: { args },
    }), 180_000);
    check(result.status === 200, 'Real native manager HTTP carrier');
    const envelope = JSON.parse(result.text);
    check(envelope.type === 'server-response' && envelope.result?.ok === true,
      'Real native manager RPC envelope');
    return envelope.result.value;
  };
  const protectedName = '@soulwhisper/dsh-forward-auth';
  const before = await rpc('listBundles', {});
  check(before.some(bundle => bundle.name === protectedName && bundle.enabled), 'Required forward-auth bundle selected');
  if (process.env.DSH_PROFILE === 'web') {
    const context = before.find(bundle => bundle.name === 'dsh-context');
    check(context?.enabled === true && context.installed === true
      && context.availability === 'profile' && context.removable === true
      && context.readOnlyReason === undefined, 'dsh-context is profile-owned and removable');
    const mnemon = before.find(bundle => bundle.name === 'dsh-mnemon');
    check(mnemon?.enabled === true && mnemon.installed === true
      && mnemon.availability === 'profile' && mnemon.removable === true
      && mnemon.readOnlyReason === undefined, 'dsh-mnemon is profile-owned and removable');
    const sessionManager = before.find(bundle => bundle.name === 'dsh-session-manager');
    check(sessionManager?.enabled === true && sessionManager.installed === true
      && sessionManager.availability === 'profile' && sessionManager.removable === true
      && sessionManager.readOnlyReason === undefined, 'dsh-session-manager is profile-owned and removable');
  } else {
    for (const name of ['dsh-better-sidebar', 'dsh-dream-skin', 'dsh-tavern-plugin',
      'dsh-tavern-remote', 'dsh-asset-library', 'dsh-tavern-stage']) {
      const bundle = before.find(item => item.name === name);
      check(bundle?.enabled === true && bundle.installed === true
        && (bundle.removable === false || bundle.readOnlyReason === 'management-required'),
        `Pinned Tavern bundle is manager-protected: ${name}`);
    }
  }
  const rows = await rpc('listPlugins', {});
  const authRow = rows.find(row => row.moduleName === protectedName);
  check(typeof authRow?.entryId === 'string', 'Native forward-auth inventory entry');
  if (process.env.DSH_PROFILE === 'tavern') {
    for (const name of ['dsh-better-sidebar', 'dsh-dream-skin', 'dsh-tavern-plugin',
      'dsh-tavern-remote', 'dsh-asset-library', 'dsh-tavern-stage']) {
      const bundle = before.find(item => item.name === name);
      // A bundle row can be named by a relative module path (dsh-asset-library
      // uses ./lib/index.js), so match the declared bundle rows as well as the
      // package name. Both read-only reasons mean the manager cannot change it.
      const bundleRows = bundle?.rows ?? [];
      const packageRows = rows.filter(item => item.moduleName === name);
      const matched = packageRows.length > 0
        ? packageRows
        : rows.filter(item => bundleRows.some(bundleRow => bundleRow.moduleName === item.moduleName));
      check(matched.length > 0
        && matched.every(row => ['management-required', 'unaddressable'].includes(row.readOnlyReason)),
        `Pinned Tavern plugin rows are read-only: ${name}`);
    }
  }
  for (const [method, args] of [
    ['setPluginEnabled', { id: authRow.entryId, enabled: false }],
    ['setBundleEnabled', { name: protectedName, enabled: false }],
    ['removeBundle', { name: protectedName }],
    ['installBundle', { spec: protectedName }],
  ]) {
    const rejected = await rpc(method, args);
    check(rejected.application === 'failed'
      && ['management-required', 'not-removable'].includes(rejected.error?.code), 'Native forward-auth mutation refusal');
  }
  if (process.env.DSH_PROFILE === 'web') {
    const status = await request('/dsh-market/status', headers, 'GET', undefined, 30_000);
    const state = JSON.parse(status.text);
    check(status.status === 200 && state.version === '1.73.12' && state.pnpm === true
      && state.agentGuardAvailable === true, 'Real market/native-manager availability');
    const forbidden = await request('/dsh-market/uninstall', headers, 'POST', JSON.stringify({ name: protectedName }), 180_000);
    const refusal = JSON.parse(forbidden.text);
    check(forbidden.status >= 400 && refusal.ok !== true
      && /management-required|not-removable/u.test(JSON.stringify(refusal)), 'Market cannot remove required forward-auth');
    // The Web profile bundles the sidebar at 0.30.1. Remove it through the
    // market first so the pinned 0.30.1 install exercises a real install instead
    // of the manager's already-installed refusal.
    const removedBundled = await request('/dsh-market/uninstall', headers, 'POST',
      JSON.stringify({ name: 'dsh-better-sidebar' }), 180_000);
    const removedBundledBody = JSON.parse(removedBundled.text);
    check(removedBundled.status === 200 && removedBundledBody.ok === true,
      'Market can remove a bundled Web plugin');
    const registry = await request('/dsh-market/registry', headers, 'GET', undefined, 90_000);
    check(registry.status === 200, 'Real curated market catalog');
    const entry = JSON.parse(registry.text).registry?.plugins?.find(plugin =>
      plugin.npm === 'dsh-better-sidebar' || plugin.name === 'dsh-better-sidebar');
    check(typeof entry?.url === 'string', 'Real curated sidebar catalog entry');
    const installed = await request('/dsh-market/install', headers, 'POST',
      JSON.stringify({ url: entry.url, version: '0.30.1' }), 180_000);
    const installedBody = JSON.parse(installed.text);
    check(installed.status === 200 && installedBody.ok === true,
      `Pinned plugin market install (status ${installed.status})`);
    // Exercise the exact SAME shipped market adapter against the actual remote manager,
    // not a mock. Existing installs require native remove + add; direct add is refused.
    const adapterURL = new URL('lib/official-desktop.js', pathToFileURL(runtimeRequire.resolve('dshmarket/package.json')));
    const { createOfficialDesktopRuntime } = await import(adapterURL.href);
    const calls = [];
    const actualManager = {
      installBundle: async (spec, options) => {
        calls.push('installBundle');
        return rpc('installBundle', options === undefined ? { spec } : { spec, options });
      },
      removeBundle: async name => {
        calls.push('removeBundle');
        return rpc('removeBundle', { name });
      },
      cancelInstall: async requestId => {
        calls.push('cancelInstall');
        return rpc('cancelInstall', { requestId });
      },
    };
    const adapter = createOfficialDesktopRuntime(() => actualManager, 'web', '/data/dsh/profiles/web');
    try {
      const reinstalled = await adapter.runPlugin('web', ['add', 'dsh-better-sidebar@0.30.1']);
      check(reinstalled.exitCode === 0 && calls.filter(method => method === 'installBundle').length === 2
        && calls.includes('removeBundle'), 'Real adapter/native-manager exact-version reinstall');
    } finally { await adapter.dispose(); }
    const updated = await request('/dsh-market/update', headers, 'POST',
      JSON.stringify({ name: 'dsh-better-sidebar', force: true, compatVersion: '0.30.1' }), 180_000);
    const update = JSON.parse(updated.text);
    check(updated.status === 200 && update.ok === true && update.skipped === 'current'
      && update.version === '0.30.1', 'Exact-current market update is honestly a no-op');
  }
  const after = await rpc('listBundles', {});
  check(after.some(bundle => bundle.name === protectedName && bundle.enabled), 'forward-auth remains selected after mutation attempts');
}

async function nativePty() {
  const subprocessRequire = createRequire(runtimeRequire.resolve('@deepseek-ai/dsh-subprocess-local'));
  const pty = subprocessRequire('node-pty');
  await new Promise((resolve, reject) => {
    const terminal = pty.spawn('/bin/sh', ['-c', 'test -t 0 && test -t 1 && printf DSH_NATIVE_PTY_OK'], {
      name: 'xterm-256color', cols: 80, rows: 24, cwd: '/workspace', env: process.env,
    });
    let output = '';
    const timer = setTimeout(() => { terminal.kill(); reject(new Error('Native PTY deadline')); }, 10_000);
    terminal.onData(data => { output += data; });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (exitCode === 0 && output.includes('DSH_NATIVE_PTY_OK')) resolve();
      else reject(new Error('Native PTY failed'));
    });
  });
}

async function architecture() {
  check(process.arch === config.arch, 'Architecture mismatch');
  const manifestPath = '/opt/dsh/runtime/package.json';
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const require = createRequire(manifestPath);
  // The CLI package exposes bin subpaths, not an importable main entry.
  // Verify presence by path and import ESM packages that exercise the runtime.
  for (const name of Object.keys(manifest.dependencies)) {
    await stat(`/opt/dsh/runtime/node_modules/${name}`);
  }
  for (const name of ['@soulwhisper/dsh-forward-auth', 'yaml']) {
    await import(pathToFileURL(require.resolve(name)).href);
  }
  await nativePty();
  const profile = process.env.DSH_PROFILE;
  check(['web', 'tavern'].includes(profile), 'Known profile');
  if (profile === 'tavern') {
    check((await stat('/opt/apps/dsh-tavern/LICENSE')).isFile(), 'Tavern original license');
  }
}

async function runtime() {
  check(process.getuid() === 1000 && process.getgid() === 1000, 'Non-root runtime');
  check(process.env.DSH_HOME === '/data/dsh' && process.env.HOME === '/data/home'
    && process.env.XDG_CACHE_HOME === '/cache' && process.env.DSH_BACKUP_ROOT === '/backups',
    'Persistent path contract');
  const cache = await lstat('/data/dsh/cache');
  const logs = await lstat('/data/dsh/logs');
  check(cache.isSymbolicLink() && await readlink('/data/dsh/cache') === '/cache/dsh', 'DSH cache is on its own volume');
  check(logs.isSymbolicLink() && await readlink('/data/dsh/logs') === '/logs', 'DSH logs are on their own volume');
  const profile = process.env.DSH_PROFILE;
  check(['web', 'tavern'].includes(profile), 'Known profile');
  // `--dump-config` intentionally keeps !!js expressions raw. Evaluate the
  // installed condition directly for both profiles; the composed dump below
  // checks the privacy defaults for both profiles.
  const forwardAuthPatch = await readFile('/opt/dsh/runtime/node_modules/@soulwhisper/dsh-forward-auth/cordis.patch.yml', 'utf8');
  const disabledExpression = forwardAuthPatch.match(/^  disabled: !!js (.+)$/mu)?.[1]?.trim();
  check(disabledExpression, 'Optional skill roots expose a condition');
  const disabledFor = dirs => new Function('process', `return ${disabledExpression}`)({
    env: { DSH_SKILL_DIRS: dirs },
  });
  check(disabledFor(undefined) === true, 'Optional skill roots are disabled when unset');
  check(disabledFor('') === true, 'Optional skill roots are disabled when empty');
  check(disabledFor('/skills') === false, 'Optional skill roots are enabled when set');
  // Tavern's profile is larger than the smoke /tmp tmpfs; /data is the
  // writable state volume. The temporary home is removed in the finally block.
  const defaultsHome = await mkdtemp(join('/data', 'dsh-defaults-'));
  try {
    await cp(`/opt/dsh/seed/profiles/${profile}`, join(defaultsHome, 'profiles', profile), {
      recursive: true, verbatimSymlinks: true,
    });
    const dump = spawnSync('/opt/dsh/runtime/node_modules/.bin/dsh', ['--profile', profile, '--dump-config'], {
      env: { ...process.env, DSH_HOME: defaultsHome, DSH_PROFILE: profile },
      encoding: 'utf8', timeout: 30_000,
    });
    check(dump.status === 0, 'Profile composition dump');
    check(/id: session-log-deepseek\n  name: [^\n]+\n  config:\n    enabled: false/u.test(dump.stdout),
      'Official-API Session-log upload is opt-in');
    check(/id: ui-settings-models\n  name: [^\n]+\n  config:\n    credentialOnboarding: false/u.test(dump.stdout),
      'Automatic credential onboarding is off by default');
    if (profile === 'web') {
      // Tavern's own profile patch intentionally disables the optional
      // skill-filesystem row; the installed condition is evaluated above.
      check(/id: skill-filesystem\n  name: [^\n]+\n  disabled: !!js[^\n]*DSH_SKILL_DIRS[^\n]*trim/u.test(dump.stdout),
        'Skill provider stays conditional on DSH_SKILL_DIRS');
    }
  } finally {
    await rm(defaultsHome, { recursive: true, force: true });
  }
  const manifestPath = `/data/dsh/profiles/${profile}/package.json`;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const profileRequire = createRequire(manifestPath);
  const expected = profile === 'web' ? ['@soulwhisper/dsh-forward-auth', 'dshmarket', 'dsh-context', 'dsh-mnemon', '@michengai/dsh-automation', '@xmanrui/dsh-im', 'dsh-better-sidebar', '@linxin666/dsh-ssh', 'dsh-session-manager']
    : ['@soulwhisper/dsh-forward-auth', 'dsh-better-sidebar', 'dsh-dream-skin', 'dsh-tavern-plugin',
      'dsh-tavern-remote', 'dsh-asset-library', 'dsh-tavern-stage'];
  for (const name of expected) check(Object.hasOwn(manifest.dependencies, name), 'Required profile package');
  if (profile === 'tavern') {
    for (const name of ['dsh-tavern-wrongbook', 'dsh-tavern-knock-knock', 'narrative-anchor']) {
      check(!Object.hasOwn(manifest.dependencies, name), `Removed ecosystem package is absent: ${name}`);
      check(!manifest.dsh.profile.bundles.includes(name), `Removed ecosystem bundle is absent: ${name}`);
    }
    for (const name of ['dsh-web-mobile', 'dsh-pocket']) {
      check(!Object.hasOwn(manifest.dependencies, name), `Intentionally dropped package is absent: ${name}`);
      check(!manifest.dsh.profile.bundles.includes(name), `Intentionally dropped bundle is absent: ${name}`);
    }
  }
  if (profile === 'web') {
    check(manifest.dependencies['dsh-context'] === '0.82.0', 'Bundled dsh-context release');
    check(manifest.dependencies['@linxin666/dsh-ssh'] === '0.4.15', 'Bundled SSH plugin');
    check(manifest.dependencies['dsh-session-manager'] === '0.7.5', 'Bundled session-manager plugin');
    check((await stat('/data/memory')).isDirectory(), 'Durable memory root exists');
    check((await stat('/usr/local/bin/mnemon')).isFile(), 'Bundled Mnemon CLI');
    const mnemon = spawnSync('/usr/local/bin/mnemon', ['--version'], { encoding: 'utf8' });
    // The native binary prints "mnemon version X.Y.Z"; accept any semver so a
    // future wording change does not break the image smoke.
    check(mnemon.status === 0 && /\b\d+\.\d+\.\d+\b/u.test(mnemon.stdout),
      'Bundled Mnemon CLI runs with its native platform binary');
  }
  if (profile === 'tavern') {
    check(!Object.hasOwn(manifest.dependencies, 'dsh-tavern-comfy'), 'Legacy Tavern image package removed');
  }
  if (profile === 'web') {
    check(await absent('/opt/dsh/runtime/node_modules/dsh-context'), 'dsh-context is not immutable runtime content');
    check((await stat('/opt/dsh/seed/skills/rtk/SKILL.md')).isFile(), 'RTK skill seed');
    check((await stat('/opt/dsh/seed/skills/caveman/SKILL.md')).isFile(), 'Caveman skill seed');
    check((await stat('/opt/dsh/seed/skills/caveman/LICENSE')).isFile(), 'Caveman license retained');
    check((await stat('/opt/dsh/seed/skills/caveman/NOTICE')).isFile(), 'Caveman notice retained');
    check((await stat('/opt/dsh/distribution-source/docker/skills/rtk/SKILL.md')).isFile(), 'Web skill source payload');
    check((await stat('/usr/local/share/rtk/LICENSE')).isFile(), 'RTK license retained');
    check(spawnSync('/usr/local/bin/rtk', ['--version'], { encoding: 'utf8' }).status === 0, 'RTK binary runs');
  } else {
    for (const path of ['/opt/dsh/seed/skills', '/opt/dsh/distribution-source/docker/skills',
      '/usr/local/bin/rtk', '/usr/local/share/rtk', '/opt/dsh/runtime/node_modules/dsh-context']) {
      check(await absent(path), `Tavern excludes Web optional asset ${path}`);
    }
  }
  for (const path of ['/opt/dsh/.agents', '/opt/dsh/distribution-source/.agents']) {
    check(await absent(path), `Maintainer skill is not bundled: ${path}`);
  }
  for (const name of Object.keys(manifest.dependencies)) {
    await import(pathToFileURL(profileRequire.resolve(name)).href);
  }
  if (profile === 'tavern') {
    check((await stat('/opt/apps/dsh-tavern/node_modules/jsdom')).isDirectory(), 'Tavern workspace dependency');
    check((await stat('/opt/apps/dsh-tavern/LICENSE')).isFile(), 'Tavern original license');
    check((await stat('/opt/apps/dsh-tavern/node_modules/sharp/package.json')).isFile(),
      'Tavern asset-library sharp dependency linked');
    const sharp = spawnSync(process.execPath, ['--input-type=module', '-e', "import('sharp').then(m => { if (!m.default) process.exit(1) })"],
      { cwd: '/opt/apps/dsh-tavern', encoding: 'utf8' });
    check(sharp.status === 0, 'Tavern asset-library sharp loads');
    const bundled = JSON.parse(await readFile('/opt/apps/dsh-tavern/tavern-plugin/packages/dsh-tavern-image-bundled/BUNDLED-VERSION.json', 'utf8'));
    check(bundled.name === 'dsh-tavern-image' && bundled.version === '3.4.0', 'Tavern bundled scene-image version');
    const installed = JSON.parse(await readFile('/data/dsh/profile-data/tavern/data/plugins/dsh-tavern-image/package.json', 'utf8'));
    check(installed.name === 'dsh-tavern-image' && installed.version === '3.4.0', 'Tavern bundled scene-image install');
    const archive = spawnSync('tar', ['-tzf', process.env.DSH_SOURCE_ARCHIVE], { encoding: 'utf8' });
    check(archive.status === 0 && archive.stdout.includes('dsh-tavern/LICENSE')
      && archive.stdout.includes('dsh-tavern/tavern-plugin/src/')
      && archive.stdout.includes('distribution/docker/tavern.Dockerfile')
      && archive.stdout.includes('distribution/docs/source-build.md')
      && archive.stdout.includes('distribution/docs/regulations.md')
      && archive.stdout.includes('distribution/patches/dsh/patch-host.mjs')
      && archive.stdout.includes('distribution/patches/tavern/patch-tavern.mjs')
      && !archive.stdout.includes('distribution/patches/wrongbook/')
      && !archive.stdout.includes('distribution/scripts/seed-tavern-tools.mjs')
      && !archive.stdout.includes('distribution/test/')
      && !archive.stdout.includes('distribution/scripts/smoke.mjs')
      && !archive.stdout.includes('distribution/deploy/')
      && !archive.stdout.includes('distribution/.github/'), 'Complete slim Tavern source/build recipe archive');
  }
  await nativePty();
}
try {
  if (mode === 'untrusted') await rejection({ [forwardHeader]: config.uid, 'x-forwarded-for': '127.0.0.1' });
  else if (mode === 'trusted') await trusted();
  else if (mode === 'manager') await manager();
  else if (mode === 'runtime') await runtime();
  else if (mode === 'arch') await architecture();
  else throw new Error('Unknown probe');
  console.log(`PASS ${mode}`);
} catch (error) {
  const label = ['trusted', 'untrusted', 'runtime', 'manager', 'arch'].includes(mode) ? mode : 'probe';
  if (error?.code === 'ERR_ASSERTION' && typeof error.message === 'string') console.error(`FAIL ${label}: ${error.message}`);
  else console.error(`FAIL ${label}: probe failed${mode === 'trusted' ? ` at ${probeStage}` : ''}; details withheld`);
  process.exitCode = 1;
}
