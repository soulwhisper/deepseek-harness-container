#!/usr/bin/env node
// Direct-environment runtime check. Requires a production install of
// docker/runtime plus the exact-hash host and market patches; no Docker.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtimeManifest = new URL('../docker/runtime/web/package.json', import.meta.url);
const require = createRequire(runtimeManifest);
const expectedArch = process.env.EXPECTED_ARCH;
if (expectedArch) assert.equal(process.arch, expectedArch, `Expected ${expectedArch}, got ${process.arch}`);

async function importPackage(name) {
  await import(pathToFileURL(require.resolve(name)).href);
}
await importPackage('@soulwhisper/dsh-forward-auth');
await importPackage('yaml');

function packageSource(name) {
  return readFile(join(dirname(require.resolve(name)), '..', 'lib/index.js'), 'utf8');
}
const host = await packageSource('@deepseek-ai/dsh-host-webserver');
const manager = await packageSource('@deepseek-ai/dsh-plugin-manager');
const boot = await packageSource('@deepseek-ai/dsh-app-boot');
const market = await packageSource('dshmarket');
assert.match(host, /required-access-gate-v1/u, 'Patched Host gate API');
assert.match(host, /runRequiredAccessGate/u, 'Patched Host route guard');
assert.match(manager, /@soulwhisper\/dsh-forward-auth/u, 'Patched manager protects forward-auth');
assert.match(manager, /@deepseek-ai\/dsh-app-boot/u, 'Patched manager protects app-boot');
assert.match(boot, /distribution-forward-auth/u, 'Patched startup requires forward-auth');
assert.doesNotMatch(boot, /"dsh-market"/u, 'Web market remains optional, not required');
assert.match(boot, /distributionStartupReady/u, 'Patched startup readiness audit');
assert.match(market, /createOfficialDesktopRuntime/u, 'Patched market uses native manager');

const subprocessRequire = createRequire(require.resolve('@deepseek-ai/dsh-subprocess-local'));
const pty = subprocessRequire('node-pty');
await new Promise((resolve, reject) => {
  const terminal = pty.spawn('/bin/sh', ['-c', 'printf FIELD_TEST_PTY_OK'], {
    name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env,
  });
  let output = '';
  const timer = setTimeout(() => { terminal.kill(); reject(new Error('Field-test PTY deadline')); }, 10_000);
  terminal.onData(data => { output += data; });
  terminal.onExit(({ exitCode }) => {
    clearTimeout(timer);
    if (exitCode === 0 && output.includes('FIELD_TEST_PTY_OK')) resolve();
    else reject(new Error('Field-test PTY failed'));
  });
});
console.log(`PASS field-test: ${process.arch}, patched host/manager/boot/market-optional, native PTY`);
