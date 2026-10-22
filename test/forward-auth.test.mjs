// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import { configuration, externalIdentity, identityFailure, createAdmission } from '../plugins/forward-auth/admission.mjs';
import { patchSource } from '../patches/dsh/patch-host.mjs';

const rootRequire = createRequire(import.meta.url);
function resolvePackage(name) {
  try { return rootRequire.resolve(name); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    const anchor = process.env.DSH_TEST_RUNTIME ? pathToFileURL(process.env.DSH_TEST_RUNTIME + '/package.json') : new URL('../docker/runtime/package.json', import.meta.url);
    return createRequire(anchor).resolve(name);
  }
}
let modules;
async function nativeModules() {
  if (!modules) modules = (async () => {
    const hostPath = resolvePackage('@deepseek-ai/dsh-host-webserver');
    const hostRequire = createRequire(hostPath);
    const raw = await readFile(hostPath, 'utf8');
    let source = patchSource('host', raw);
    // The exact published server runs unchanged except the distribution patch.
    // Absolute import locations let the temporary real module reuse installed dependencies.
    source = source.replace(/from "([^"\n]+)"/g, (match, name) => name.startsWith('node:') ? match : `from ${JSON.stringify(pathToFileURL(hostRequire.resolve(name)).href)}`);
    const temporary = await mkdtemp(join(tmpdir(), 'dsh-forward-auth-host-'));
    let host;
    try {
      const path = join(temporary, 'host.mjs');
      await writeFile(path, source);
      host = await import(pathToFileURL(path).href);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    const cordis = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')).href);
    const connection = await import(pathToFileURL(resolvePackage('@deepseek-ai/dsh-client-connection')).href);
    return { ...host, ...cordis, connection };
  })();
  return modules;
}
const AUTH_HEADER = 'x-authentik-uid';
const baseEnvironment = {
  DSH_FORWARD_AUTH_HEADER: AUTH_HEADER,
  DSH_FORWARD_AUTH_ALLOWED_SUBJECTS: 'stable_uid,another-uid',
  DSH_FORWARD_AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,2001:db8::/32',
};
function facts(peer, uid = 'stable_uid', extra = [], url = '/', header = AUTH_HEADER) {
  return { url, socket: { remoteAddress: peer }, rawHeaders: ['Host', 'dsh.example', header, uid, ...extra], headers: { host: 'dsh.example', [header.toLowerCase()]: uid } };
}
function get(port, path = '/', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers: { host: 'dsh.example', ...headers }, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}
async function fixture(t, { native = false } = {}) {
  const { Context, WebServer, connection } = await nativeModules();
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  const fiber = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0, compression: 'none', compressionLevel: 1, compressionThresholdBytes: 1024 });
  await fiber.await();
  const server = ctx.webServer;
  if (native) {
    let credential;
    ctx.provide('credentials', {
      async modifyRecord(_key, change) {
        const update = await change(credential);
        if (update) credential = update;
        return credential;
      },
    });
    await ctx.plugin(connection, { trustedHosts: ['dsh.example'] }).await();
  }
  const releaseRoute = server.registerFallback((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(req.url); });
  t.after(releaseRoute);
  return { ctx, server, port: server.port };
}

test('configuration requires header, subjects, trust CIDRs and bounded timers', () => {
  assert.throws(() => configuration({}), /mandatory/);
  for (const value of ['', 'bad header', 'host', 'origin', 'cookie']) {
    assert.throws(() => configuration({ ...baseEnvironment, DSH_FORWARD_AUTH_HEADER: value }), /HEADER/);
  }
  for (const value of ['127.0.0.1', 'hostname/32', '127.0.0.1/33', '::ffff:127.0.0.1/128', '127.0.0.1/32,']) assert.throws(() => configuration({ ...baseEnvironment, DSH_FORWARD_AUTH_TRUSTED_PROXY_CIDRS: value }));
  for (const value of ['', '0', '-1', '1.5', '2147484']) assert.throws(() => configuration({ ...baseEnvironment, DSH_FORWARD_AUTH_MAX_CONNECTION_SECONDS: value }));
  assert.equal(configuration(baseEnvironment).header, AUTH_HEADER);
  assert.equal(configuration(baseEnvironment).maxConnectionMilliseconds, 900000);
});

test('generic forward-auth headers and upstream launch-token URLs', () => {
  const authelia = configuration({ ...baseEnvironment, DSH_FORWARD_AUTH_HEADER: 'Remote-User' });
  assert.equal(externalIdentity(facts('127.0.0.1', 'stable_uid', [], '/', 'Remote-User'), authelia), true);
  assert.equal(externalIdentity(facts('127.0.0.1'), authelia), false);
  assert.equal(identityFailure(facts('127.0.0.1', 'stable_uid', [], '/?token=upstream'), configuration(baseEnvironment)), 'upstream-token');
  assert.equal(identityFailure(facts('127.0.0.1', 'stable_uid', [], '/?clean=yes'), configuration(baseEnvironment)), undefined);
});

test('peer CIDRs normalize mapped IPv6 but never trust forwarded IPs', () => {
  const config = configuration(baseEnvironment);
  for (const peer of ['127.0.0.1', '::ffff:127.0.0.1', '::ffff:7f00:1', '2001:db8::3']) assert.equal(externalIdentity(facts(peer), config), true, peer);
  for (const peer of ['127.0.0.2', '::1', '2001:db9::3', undefined, 'malformed']) assert.equal(externalIdentity(facts(peer), config), false, String(peer));
  const spoof = facts('192.0.2.1'); spoof.headers['x-forwarded-for'] = '127.0.0.1';
  assert.equal(externalIdentity(spoof, config), false);
});

test('identity rejects duplicate/coalesced/invalid identity and trust headers', () => {
  const config = configuration(baseEnvironment);
  for (const value of ['unknown', ' stable_uid', 'stable_uid ', 'stable_uid,another-uid', '', 'stable_uid\t']) assert.equal(externalIdentity(facts('127.0.0.1', value), config), false);
  for (const extra of [['X-Authentik-Uid', 'stable_uid'], ['HOST', 'other'], ['Origin', 'a', 'origin', 'b'], ['Cookie', 'a=b', 'cookie', 'c=d']]) assert.equal(externalIdentity(facts('127.0.0.1', 'stable_uid', extra), config), false);
});

test('actual patched Host denies first accept, all route types and every upgrade without a gate', async t => {
  const { server, port } = await fixture(t);
  server.register({ kind: 'exact', path: '/exact', handler: (_req, res) => res.end('unguarded') });
  server.register({ kind: 'prefix', path: '/prefix', handler: (_req, res) => res.end('unguarded') });
  for (const path of ['/', '/exact', '/prefix/child', '/unknown', '/connect?token=anything']) assert.equal((await get(port, path)).status, 503);
  const socket = connect(port, '127.0.0.1');
  const data = [];
  socket.on('data', chunk => data.push(chunk));
  socket.write('GET /ws HTTP/1.1\r\nHost: dsh.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  await once(socket, 'close');
  assert.match(Buffer.concat(data).toString(), /^HTTP\/1.1 503/);
});

test('actual native Connection exchanges cookie internally and preserves Host/Origin403', async t => {
  const { ctx, server, port } = await fixture(t, { native: true });
  const admission = createAdmission(ctx.connection, configuration(baseEnvironment));
  const release = server.registerRequiredAccessGate(admission);
  t.after(() => { release(); admission.dispose(); });
  assert.equal((await get(port)).status, 403);
  assert.equal((await get(port, '/?token=upstream', { [AUTH_HEADER]: 'stable_uid' })).status, 403, 'upstream token URL is blocked even with an edge identity');
  const allowed = await get(port, '/?clean=yes', { 'x-authentik-uid': 'stable_uid', origin: 'http://dsh.example' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body, '/?clean=yes');
  assert.equal(allowed.headers.location, undefined);
  assert.equal(allowed.headers['set-cookie'].length, 1);
  const cookie = allowed.headers['set-cookie'][0].split(';')[0];
  assert.ok(cookie.includes('='));
  assert.doesNotMatch(allowed.body, /token=/);
  assert.equal((await get(port, '/', { cookie })).status, 403, 'native cookie does not replace external identity');
  const reused = await get(port, '/', { cookie, 'x-authentik-uid': 'stable_uid' });
  assert.equal(reused.status, 200);
  assert.equal(reused.headers['set-cookie'], undefined, 'valid native cookie is not reissued');
  assert.equal((await get(port, '/', { 'x-authentik-uid': 'stable_uid', origin: 'http://evil.example' })).status, 403);
  assert.equal((await get(port, '/', { 'x-authentik-uid': 'stable_uid', host: 'evil.example' })).status, 403);
  const invalidCookie = await get(port, '/', { 'x-authentik-uid': 'stable_uid', cookie: cookie.split('=')[0] + '=invalid; unrelated=retained' });
  assert.equal(invalidCookie.status, 200, 'invalid native cookie replaced after external admission');
  server.register({ kind: 'exact', path: '/cookies', handler: (_req, res) => {
    res.appendHeader('set-cookie', 'unrelated=preserved; Path=/; HttpOnly');
    res.end('cookies');
  } });
  const combined = await get(port, '/cookies', { 'x-authentik-uid': 'stable_uid' });
  assert.equal(combined.headers['set-cookie'].length, 2, 'native cookie appended without comma-folding or dropping route cookie');
  assert.ok(combined.headers['set-cookie'].includes('unrelated=preserved; Path=/; HttpOnly'));
});

test('disposing a gate closes real streams/upgrades and reloading never opens fallback', async t => {
  const { server, port } = await fixture(t);
  const gate = { http: () => true, upgrade: () => true };
  const release = server.registerRequiredAccessGate(gate);
  assert.throws(() => server.registerRequiredAccessGate(gate), /already registered/);
  server.register({ kind: 'exact', path: '/stream', handler: (_req, res) => { res.writeHead(200); res.write('stream'); } });
  server.registerUpgrade({ path: '/ws', handler: (_req, socket) => socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n') });
  const stream = connect(port, '127.0.0.1');
  stream.write('GET /stream HTTP/1.1\r\nHost: dsh.example\r\n\r\n');
  await once(stream, 'data');
  const upgraded = connect(port, '127.0.0.1');
  upgraded.write('GET /ws HTTP/1.1\r\nHost: dsh.example\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n');
  await once(upgraded, 'data');
  const closed = Promise.all([once(stream, 'close'), once(upgraded, 'close')]);
  release();
  await closed;
  assert.equal((await get(port)).status, 503);
  const releaseNext = server.registerRequiredAccessGate({ http: () => true, upgrade: () => true });
  release();
  assert.equal((await get(port)).status, 200, 'stale disposer cannot revoke new generation');
  releaseNext();
  assert.equal((await get(port)).status, 503);
});

test('gate exception permanently denies until a deliberate replacement registration', async t => {
  const { server, port } = await fixture(t);
  server.registerRequiredAccessGate({ http() { throw new Error('failure'); }, upgrade() { throw new Error('failure'); } });
  await assert.rejects(get(port));
  assert.equal((await get(port)).status, 503);
});

test('admission reports fixed status reasons without exposing identity', () => {
  const config = configuration(baseEnvironment);
  const events = [];
  const response = () => ({ writeHead() {}, end() {} });
  const connection = { requestRejection: () => undefined, authorizeIndex() {}, authenticatedUrl() {} };
  const gate = createAdmission(connection, config, { report: event => events.push(event) });
  gate.http(facts('127.0.0.2'), response());
  gate.http(facts('127.0.0.1'), response());
  assert.deepEqual(events, [{ type: 'denied', reason: 'untrusted-peer' }, { type: 'active' }]);

  const broken = [];
  const failing = createAdmission({ requestRejection() { throw new Error('fixture'); }, authorizeIndex() {}, authenticatedUrl() {} },
    config, { report: event => broken.push(event) });
  assert.throws(() => failing.http(facts('127.0.0.1'), response()), /fixture/);
  assert.deepEqual(broken, [{ type: 'broken', reason: 'native-rejection' }]);
});

test('top-level cross-site navigation is admitted; cross-site API and POST are not', () => {
  const config = configuration(baseEnvironment);
  const seen = [];
  const connection = {
    requestRejection(request) {
      const site = request.headers['sec-fetch-site'];
      seen.push(site);
      return site === 'cross-site' ? 403 : undefined;
    },
    authorizeIndex() {},
    authenticatedUrl() {},
  };
  const gate = createAdmission(connection, config);
  const response = () => ({ writeHead() {}, end() {} });
  const base = facts('127.0.0.1');
  const navigation = {
    ...base,
    method: 'GET',
    headers: { ...base.headers, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
  };
  assert.equal(gate.http(navigation, response()), true);
  const iframe = {
    ...base,
    method: 'GET',
    headers: { ...base.headers, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' },
  };
  assert.equal(gate.http(iframe, response()), false);
  const api = { ...base, method: 'GET', headers: { ...base.headers, 'sec-fetch-site': 'cross-site' } };
  assert.equal(gate.http(api, response()), false);
  const post = { ...base, method: 'POST', headers: { ...navigation.headers } };
  assert.equal(gate.http(post, response()), false);
  const upgradeSocket = new EventEmitter();
  upgradeSocket.destroy = () => {};
  upgradeSocket.end = () => {};
  assert.equal(gate.upgrade({ ...navigation }, upgradeSocket), false);
  assert.deepEqual(seen, [undefined, 'cross-site', 'cross-site', 'cross-site', 'cross-site']);
});

test('minted navigation cookie reaches the dispatched request and keeps sec-fetch-site', () => {
  const config = configuration(baseEnvironment);
  const connection = {
    authenticatedUrl: () => 'http://dsh.invalid/?token=fixture',
    authorizeIndex(_request, response) {
      response.writeHead(303, { 'set-cookie': 'dsh_session=fixture; Path=/; HttpOnly; SameSite=Strict' });
      response.end();
      return false;
    },
    requestRejection(request) {
      return request.headers.cookie?.includes('dsh_session=fixture') ? undefined : 401;
    },
  };
  const gate = createAdmission(connection, config);
  let appended;
  const response = { writeHead() {}, end() {}, appendHeader(name, value) { appended = [name, value]; } };
  const base = facts('127.0.0.1');
  const navigation = {
    ...base,
    method: 'GET',
    headers: { ...base.headers, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
  };
  assert.equal(gate.http(navigation, response), true);
  assert.equal(navigation.headers['sec-fetch-site'], 'cross-site');
  assert.match(navigation.headers.cookie, /(?:^|; )dsh_session=fixture(?:;|$)/u);
  assert.equal(appended[0], 'set-cookie');
  assert.match(appended[1], /dsh_session=fixture/u);
});

test('upgrade timers are bounded, cleared on close and cleaned on disposal', () => {
  const active = new Map();
  let sequence = 0;
  const gate = createAdmission({ requestRejection: () => undefined, authorizeIndex() {}, authenticatedUrl() {} }, configuration(baseEnvironment), {
    setTimer(callback, ms) { const timer = { id: ++sequence, unref() {} }; active.set(timer, { callback, ms }); return timer; },
    clearTimer(timer) { active.delete(timer); },
  });
  function socket() { const target = new EventEmitter(); target.destroyed = false; target.destroy = () => { target.destroyed = true; target.emit('close'); }; return target; }
  const first = socket();
  assert.equal(gate.upgrade(facts('127.0.0.1'), first), true);
  assert.equal([...active.values()][0].ms, 900000);
  first.destroy();
  assert.equal(active.size, 0);
  const second = socket();
  gate.upgrade(facts('127.0.0.1'), second);
  [...active.values()][0].callback();
  assert.equal(second.destroyed, true);
  assert.equal(active.size, 0);
  const third = socket();
  gate.upgrade(facts('127.0.0.1'), third);
  gate.dispose();
  assert.equal(third.destroyed, true);
  assert.equal(active.size, 0);
});

test('real Cordis readiness waits for the startup audit, disappears on unload and reload stays guarded', async t => {
  const plugin = await import('../plugins/forward-auth/index.mjs');
  const { ctx, port } = await fixture(t, { native: true });
  const saved = Object.fromEntries(Object.keys(baseEnvironment).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(baseEnvironment)) process.env[key] = value;
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const fiber = ctx.plugin(plugin);
  await fiber.await();
  const pending = connect(plugin.readinessPath);
  let premature = '';
  pending.on('data', chunk => { premature += chunk; });
  await once(pending, 'close');
  assert.equal(premature, '');
  ctx.provide('distributionStartupReady', true);
  const probe = connect(plugin.readinessPath);
  const chunks = [];
  probe.on('data', chunk => chunks.push(chunk));
  await once(probe, 'close');
  assert.equal(Buffer.concat(chunks).toString(), 'ready\n');
  assert.equal((await get(port, '/', { 'x-authentik-uid': 'stable_uid' })).status, 200);
  await fiber.dispose();
  assert.equal((await get(port)).status, 503);
  const unavailable = connect(plugin.readinessPath);
  await assert.rejects(once(unavailable, 'connect'));
  const replacement = ctx.plugin(plugin);
  await replacement.await();
  assert.equal((await get(port)).status, 403);
  await replacement.dispose();
});
