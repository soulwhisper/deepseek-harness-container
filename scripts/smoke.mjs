#!/usr/bin/env node
// Run only disposable, final-image containers. Never print their logs or response bodies.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const images = process.argv.slice(2);
if (images.length === 0) {
  console.error('Usage: node scripts/smoke.mjs WEB_IMAGE [TAVERN_IMAGE]');
  process.exit(2);
}
const probe = await readFile(new URL('./verify-runtime.mjs', import.meta.url), 'utf8');
const edgeSource = await readFile(new URL('./verify-edge.mjs', import.meta.url), 'utf8');
const prefix = `dsh-smoke-${randomBytes(6).toString('hex')}`;
const containers = [];
const volumes = [];
let network;
let egressNetwork;

async function docker(args, input, allowFailure = false) {
  return await new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 600_000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', () => { clearTimeout(timer); reject(new Error('Docker could not be started')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 && !allowFailure) {
        // Docker stderr may include credentials, native startup URLs, or response data.
        // A `docker run` failure line is daemon/option diagnostics, not app output.
        const diagnostic = args[0] === 'run' ? stderr.trim().split('\n').at(-1) : '';
        reject(new Error(`Docker ${args[0]} failed (exit ${code})${diagnostic ? `: ${diagnostic}` : ''}; raw output withheld`));
      } else resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function browserSmoke(authority, restart) {
  let browser;
  let stage = 'launch';
  let boot = 0;
  try {
    browser = await chromium.launch({ headless: true, args: [
      '--host-resolver-rules=MAP dsh.smoke.test 127.0.0.1', '--no-proxy-server',
    ] });
    const context = await browser.newContext({
      // The test edge MUST discard this forged client identity before injecting its verified one.
      extraHTTPHeaders: { 'x-authentik-uid': 'forged-browser-uid' },
    });
    const page = await context.newPage();
    let javascript = 0;
    let pageErrors = 0;
    page.on('pageerror', () => { pageErrors++; });
    page.on('response', response => {
      if (response.request().resourceType() === 'script' && response.status() === 200) javascript++;
    });
    const waitConnected = () => new Promise((resolve, reject) => {
      const observe = socket => {
        if (!new URL(socket.url()).pathname.endsWith('/api/remote.mux')) return;
        socket.on('framereceived', ({ payload }) => {
          try {
            const frame = JSON.parse(String(payload));
            if (frame.type === 'item' && frame.value?.type === 'ready'
              && typeof frame.value.clientId === 'string') {
              clearTimeout(timer);
              page.off('websocket', observe);
              resolve();
            }
          } catch { /* Other real runtime frames are not readiness evidence. */ }
        });
      };
      const timer = setTimeout(() => {
        page.off('websocket', observe);
        reject(new Error('Client connection deadline'));
      }, 60_000);
      page.on('websocket', observe);
    });
    let nativeCookie;
    for (boot = 0; boot < 2; boot++) {
      if (boot === 1) {
        stage = 'restart';
        await page.goto('about:blank');
        await restart();
      }
      javascript = 0;
      pageErrors = 0;
      stage = 'navigation';
      // Subscribe before navigation, including after a real container restart.
      const connected = waitConnected();
      const navigation = page.goto(`http://${authority}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const [response] = await Promise.all([navigation, connected]);
      stage = 'client-boot';
      if (response?.status() !== 200 || javascript === 0 || pageErrors !== 0) throw new Error('Client boot failed');
      if (new URL(page.url()).searchParams.has('token')) throw new Error('Token escaped to browser URL');
      stage = 'cookie';
      const cookies = await context.cookies();
      const cookie = cookies.find(item => item.httpOnly && item.sameSite === 'Strict');
      if (!cookie) throw new Error('Native browser cookie missing');
      if (boot === 0) nativeCookie = `${cookie.name}=${cookie.value}`;
      else if (`${cookie.name}=${cookie.value}` !== nativeCookie || response.headers()['set-cookie']) {
        throw new Error('Native browser session did not survive restart');
      }
      stage = 'render';
      if (!(await page.locator('body').innerText()).trim()) throw new Error('Client did not render');
      stage = 'sidebar';
      await page.locator('[data-dsh-better-sidebar] [data-dsh-panel-host]').waitFor({ state: 'attached', timeout: 30_000 });
      if ((await page.locator('body').innerText()).includes('[dsh-better-sidebar]')) throw new Error('Sidebar mount error');
    }
  } catch {
    throw new Error(`Real browser client boot/native-cookie/mux check failed at ${stage} (boot ${boot + 1}); raw browser output withheld`);
  } finally {
    await browser?.close();
  }
}
function hostAddress(subnet, offset) {
  const [address, bits] = subnet.split('/');
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(address) || Number(bits) > 28) {
    throw new Error('Smoke requires an IPv4 Docker network with at least sixteen addresses');
  }
  const value = address.split('.').reduce((n, octet) => n * 256 + Number(octet), 0) + offset;
  return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.');
}
const security = ['--read-only', '--user', '1000:1000', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges:true', '--pids-limit', '256',
  '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777,size=256m',
  '--tmpfs', '/data:rw,nosuid,nodev,mode=1777,size=2g'];
async function start(name, image, ip, args = [], command = []) {
  containers.push(name);
  await docker(['run', '--detach', '--name', name, '--network', network, '--ip', ip,
    ...security, ...args, image, ...command]);
}
async function execute(name, mode, config = {}) {
  const result = await docker(['exec', '-i', name, 'node', '--input-type=module', '-', mode,
    JSON.stringify(config)], probe, true);
  if (result.code !== 0 || !result.stdout.trim().endsWith(`PASS ${mode}`)) {
    const detail = result.stderr.trim().split('\n').at(-1) || 'probe failed';
    throw new Error(`Container probe ${mode} failed: ${detail}`);
  }
}
async function awaitReady(app) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (interrupted) throw new Error('Smoke interrupted');
    const health = await docker(['exec', app, 'node', '/opt/dsh/scripts/readiness.mjs'], undefined, true);
    if (health.code === 0) return;
    const state = JSON.parse((await docker(['inspect', '--format', '{{json .State}}', app])).stdout);
    if (!state.Running) throw new Error('Application exited before guarded readiness; raw logs withheld');
    await sleep(1000);
  }
  throw new Error('Guarded readiness timed out; raw logs withheld');
}
async function cleanup() {
  for (const name of containers.splice(0).reverse()) await docker(['rm', '--force', name], undefined, true);
  for (const name of volumes.splice(0)) await docker(['volume', 'rm', name], undefined, true);
  if (egressNetwork) await docker(['network', 'rm', egressNetwork], undefined, true);
  egressNetwork = undefined;
  if (network) await docker(['network', 'rm', network], undefined, true);
  network = undefined;
}
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { interrupted = true; void cleanup().finally(() => process.exit(130)); });
}
try {
  for (const [index, image] of images.entries()) {
    network = `${prefix}-${index}`;
    await docker(['image', 'inspect', image]); // Require the caller to build/pull explicitly.
    await docker(['network', 'create', '--internal', network]);
    egressNetwork = `${network}-egress`;
    await docker(['network', 'create', egressNetwork]);
    const stateVolume = `${network}-state`;
    const workspaceVolume = `${network}-workspace`;
    for (const volume of [stateVolume, workspaceVolume]) {
      volumes.push(volume);
      await docker(['volume', 'create', volume]);
    }
    const details = JSON.parse((await docker(['network', 'inspect', network])).stdout)[0];
    const subnet = details.IPAM?.Config?.find(config => config.Subnet?.includes('.'))?.Subnet
      ?? details.subnets?.find(config => config.subnet?.includes('.'))?.subnet;
    if (!subnet) throw new Error('Docker did not allocate an IPv4 smoke network');
    const edgeIP = hostAddress(subnet, 2);
    const appIP = hostAddress(subnet, 3);
    const attackerIP = hostAddress(subnet, 4);
    const edge = `${network}-edge`;
    const app = `${network}-app`;
    const attacker = `${network}-attacker`;
    // Helpers are clients from the SAME final image, not replacement app servers.
    const helperArgs = ['--entrypoint', 'node'];
    const helperCommand = ['-e', 'setInterval(() => {}, 60000)'];
    await start(edge, image, edgeIP, ['--entrypoint', 'node', '--publish', '127.0.0.1::8080'],
      ['--input-type=module', '-e', edgeSource, JSON.stringify({ host: appIP, port: 3080, uid: 'smoke-owner-uid' })]);
    const edgeState = JSON.parse((await docker(['inspect', edge])).stdout)[0];
    const publicPort = edgeState.NetworkSettings.Ports['8080/tcp'][0].HostPort;
    const authority = `dsh.smoke.test:${publicPort}`;
    await start(attacker, image, attackerIP, helperArgs, helperCommand);
    await start(app, image, appIP, [
      '--mount', `type=volume,src=${stateVolume},dst=/data/dsh`,
      '--mount', `type=volume,src=${workspaceVolume},dst=/workspace`,
      '--env', `DSH_HOST=${appIP}`, '--env', 'DSH_PORT=3080',
      '--env', `DSH_PUBLIC_URL=http://${authority}`,
      '--env', `DSH_TRUSTED_HOSTS=${authority}`,
      '--env', 'DSH_SSO_ALLOWED_UIDS=smoke-owner-uid',
      '--env', `DSH_SSO_TRUSTED_PROXY_CIDRS=${edgeIP}/32`,
      '--env', 'DSH_SSO_MAX_CONNECTION_SECONDS=20',
    ]);
    // Registry egress is separate and untrusted; the listener still binds ONLY appIP.
    await docker(['network', 'connect', egressNetwork, app]);
    await awaitReady(app);
    const config = { host: appIP, port: 3080, authority, uid: 'smoke-owner-uid' };
    await execute(attacker, 'untrusted', config);
    await execute(edge, 'trusted', config);
    await execute(edge, 'manager', config);
    await execute(app, 'runtime');
    await browserSmoke(authority, async () => {
      await docker(['restart', app]);
      await awaitReady(app);
      await execute(app, 'runtime');
    });
    const boot = await docker(['logs', app], undefined, true);
    if (/failed to import|skipping profile bundle|failed to activate/iu.test(`${boot.stdout}\n${boot.stderr}`)) {
      throw new Error('Runtime reported a profile/plugin import or activation failure; raw logs withheld');
    }
    console.log(`PASS image ${index + 1}: SSO rejection, protected manager, plugin install/reinstall, real browser/sidebar, persistent native cookie, mux, expiry, PTY, profile/source imports`);
    await cleanup();
  }
} catch (error) {
  // Only locally-authored messages are reported, never a child exception/body/URL.
  console.error(error instanceof Error ? error.message : 'Smoke failed; raw output withheld');
  process.exitCode = 1;
} finally {
  await cleanup();
}
