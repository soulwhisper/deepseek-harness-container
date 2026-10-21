// SPDX-License-Identifier: Apache-2.0
import { createServer } from 'node:net';
import { lstat, unlink, chmod } from 'node:fs/promises';
import { configuration, createAdmission } from './admission.mjs';
import { registerSource } from './source.mjs';

export const name = 'distribution-forward-auth';
export const inject = ['webServer', 'connection'];
export const readinessPath = '/tmp/dsh-forward-auth-ready.sock';

const STATUS_INTERVAL_MS = 60_000;
const DENIAL_HINTS = {
  'disposed': 'gate is stopping',
  'duplicate-cookie': 'edge forwarded duplicate Cookie headers',
  'duplicate-identity': 'edge injected duplicate identity headers',
  'duplicate-origin': 'edge forwarded duplicate Origin headers',
  'identity-mismatch': 'identity header was coalesced or rewritten',
  'invalid-host': 'request does not have exactly one Host header',
  'invalid-request': 'request headers are malformed',
  'invalid-subject': 'identity header has an invalid subject format',
  'missing-identity': 'edge/provider has not injected a subject',
  'native-fence': 'native Host/Origin fence rejected the request',
  'unknown-subject': 'subject is not in the allowlist',
  'untrusted-peer': 'request did not come from a trusted edge peer',
  'upstream-token': 'upstream launch-token URL is blocked',
};

function loggerFor() {
  // The DSH profile logger's info level is not guaranteed to reach container
  // stdout. Authentication state must be visible to operators even when the
  // profile log level suppresses info, so use stderr with fixed, secret-free
  // lines. This is the same stream Docker/Kubernetes collect.
  const write = message => {
    try { console.error(message); } catch { /* status logging must not affect admission */ }
  };
  return { info: write, warn: write, error: write };
}

function statusReporter(log) {
  let active = false;
  let degraded = false;
  let lastReason;
  let lastAt = 0;
  let suppressed = 0;
  return event => {
    if (event.type === 'active') {
      if (!active) {
        active = true;
        degraded = false;
        log.info('forward-auth: state=active provider=external verifiedIdentity=yes');
      } else if (degraded) {
        degraded = false;
        log.info('forward-auth: state=active recovered; verified edge identity observed');
      }
      return;
    }
    if (event.type === 'broken') {
      log.error(`forward-auth: state=broken reason=${event.reason}`);
      return;
    }
    if (event.type !== 'denied') return;
    const now = Date.now();
    if (event.reason === lastReason && now - lastAt < STATUS_INTERVAL_MS) {
      suppressed++;
      return;
    }
    if (suppressed > 0) {
      log.warn(`forward-auth: state=${active ? 'degraded' : 'waiting-for-edge'} reason=${lastReason} suppressed=${suppressed}; direct access remains denied`);
    }
    const hint = DENIAL_HINTS[event.reason] ?? 'request denied';
    log.warn(`forward-auth: state=${active ? 'degraded' : 'waiting-for-edge'} reason=${event.reason}; ${hint}; direct access remains denied`);
    degraded = active;
    lastReason = event.reason;
    lastAt = now;
    suppressed = 0;
  };
}

export async function apply(ctx) {
  const log = loggerFor();
  let config;
  try {
    config = configuration();
  } catch (error) {
    log.error('forward-auth: state=broken reason=configuration');
    throw error;
  }
  log.info(`forward-auth: starting mode=forward-auth header=${config.header} subjects=${config.allowedSubjects.size} trustedProxyCidrs=${config.proxyCIDRs.length}`);
  log.info('forward-auth: state=waiting-for-edge provider=external verifiedIdentity=no');
  const webServer = ctx.webServer;
  if (webServer?.requiredAccessGateVersion !== 'required-access-gate-v1'
    || typeof webServer.registerRequiredAccessGate !== 'function'
    || typeof webServer.isRequiredAccessGateActive !== 'function') {
    log.error('forward-auth: state=broken reason=webserver-contract');
    throw new Error('forward-auth: required patched WebServer API unavailable');
  }
  let admission;
  try {
    admission = createAdmission(ctx.connection, config, { report: statusReporter(log) });
  } catch (error) {
    log.error('forward-auth: state=broken reason=connection-contract');
    throw error;
  }
  try {
    await registerSource(ctx, webServer);
  } catch (error) {
    log.error('forward-auth: state=broken reason=source-contract');
    throw error;
  }
  await ctx.effect(async () => {
    let release;
    try {
      release = webServer.registerRequiredAccessGate(admission);
    } catch (error) {
      log.error('forward-auth: state=broken reason=gate-registration');
      throw error;
    }
    log.info('forward-auth: state=ready gate=required; waiting-for-edge');
    let disposed = false;
    let ownsPath = false;
    const probes = new Set();
    const server = createServer(socket => {
      probes.add(socket);
      socket.once('close', () => probes.delete(socket));
      socket.on('error', () => socket.destroy());
      if (!disposed && ctx.get('distributionStartupReady') === true && webServer.port !== undefined && webServer.isRequiredAccessGateActive(admission)) socket.end('ready\n');
      else socket.destroy();
    });
    const cleanup = async () => {
      if (disposed) return;
      disposed = true;
      // Reset admission before any asynchronous cleanup. Never restore a native listener.
      release();
      admission.dispose();
      for (const socket of probes) socket.destroy();
      await new Promise(resolve => server.close(() => resolve()));
      if (ownsPath) try { await unlink(readinessPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      log.info('forward-auth: state=stopped');
    };
    try {
      try {
        const existing = await lstat(readinessPath);
        if (!existing.isSocket() || existing.uid !== process.getuid()) throw new Error('forward-auth: unsafe readiness path');
        await unlink(readinessPath);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(readinessPath, () => { ownsPath = true; server.off('error', reject); resolve(); });
      });
      await chmod(readinessPath, 0o600);
      server.on('error', () => { release(); admission.dispose(); server.close(); });
    } catch (error) {
      log.error('forward-auth: state=broken reason=readiness');
      await cleanup();
      throw error;
    }
    return cleanup;
  }, 'distribution-forward-auth.required-access-gate');
}
