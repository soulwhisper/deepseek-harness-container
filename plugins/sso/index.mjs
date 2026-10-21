// SPDX-License-Identifier: Apache-2.0
import { createServer } from 'node:net';
import { lstat, unlink, chmod } from 'node:fs/promises';
import { configuration, createAdmission } from './admission.mjs';
import { registerSource } from './source.mjs';

export const name = 'distribution-sso';
export const inject = ['webServer', 'connection'];
export const readinessPath = '/tmp/dsh-sso-ready.sock';
export async function apply(ctx) {
  const config = configuration();
  const webServer = ctx.webServer;
  if (webServer?.requiredAccessGateVersion !== 'required-access-gate-v1' || typeof webServer.registerRequiredAccessGate !== 'function' || typeof webServer.isRequiredAccessGateActive !== 'function') throw new Error('SSO: required patched WebServer API unavailable');
  const admission = createAdmission(ctx.connection, config);
  await registerSource(ctx, webServer);
  await ctx.effect(async () => {
    const release = webServer.registerRequiredAccessGate(admission);
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
    };
    try {
      try {
        const existing = await lstat(readinessPath);
        if (!existing.isSocket() || existing.uid !== process.getuid()) throw new Error('SSO: unsafe readiness path');
        await unlink(readinessPath);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(readinessPath, () => { ownsPath = true; server.off('error', reject); resolve(); });
      });
      await chmod(readinessPath, 0o600);
      server.on('error', () => { release(); admission.dispose(); server.close(); });
    } catch (error) {
      await cleanup();
      throw error;
    }
    return cleanup;
  }, 'distribution-sso.required-access-gate');
}
