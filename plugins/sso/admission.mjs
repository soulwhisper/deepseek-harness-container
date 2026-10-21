// SPDX-License-Identifier: Apache-2.0
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

function list(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`SSO: ${field} is mandatory`);
  const values = value.split(',').map(item => item.trim());
  if (values.some(item => !item) || new Set(values).size !== values.length) throw new Error(`SSO: invalid ${field}`);
  return values;
}
function address(value) {
  if (!value || !isIP(value) || value.includes('%')) return undefined;
  const parsed = ipaddr.parse(value);
  return parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress() ? parsed.toIPv4Address() : parsed;
}
export function configuration(env = process.env) {
  const allowedUIDs = new Set(list(env.DSH_SSO_ALLOWED_UIDS, 'DSH_SSO_ALLOWED_UIDS'));
  for (const uid of allowedUIDs) if (!/^[A-Za-z0-9_-]{1,256}$/.test(uid)) throw new Error('SSO: invalid allowed UID');
  const proxyCIDRs = list(env.DSH_SSO_TRUSTED_PROXY_CIDRS, 'DSH_SSO_TRUSTED_PROXY_CIDRS').map(value => {
    const parts = value.split('/');
    const ip = address(parts[0]);
    if (parts.length !== 2 || !ip || !/^(0|[1-9]\d*)$/.test(parts[1])) throw new Error('SSO: trusted proxies must be explicit IP CIDRs');
    const prefix = Number(parts[1]);
    // Mapped CIDR notation is ambiguous after normalization: require native IPv4 CIDRs.
    if (isIP(parts[0]) === 6 && ip.kind() === 'ipv4' || prefix > (ip.kind() === 'ipv4' ? 32 : 128)) throw new Error('SSO: invalid trusted proxy CIDR');
    return [ip, prefix];
  });
  const rawSeconds = env.DSH_SSO_MAX_CONNECTION_SECONDS ?? '900';
  if (!/^[1-9]\d*$/.test(rawSeconds)) throw new Error('SSO: invalid maximum connection seconds');
  const seconds = Number(rawSeconds);
  if (!Number.isSafeInteger(seconds) || seconds * 1000 > 2 ** 31 - 1) throw new Error('SSO: maximum connection seconds exceeds timer range');
  return { allowedUIDs, proxyCIDRs, maxConnectionMilliseconds: seconds * 1000 };
}
export function externalIdentity(request, config) {
  const peer = address(request.socket.remoteAddress);
  if (!peer || !config.proxyCIDRs.some(([network, prefix]) => peer.kind() === network.kind() && peer.match(network, prefix))) return false;
  let uid;
  let identities = 0;
  let hosts = 0;
  let origins = 0;
  let cookies = 0;
  const raw = request.rawHeaders;
  if (!Array.isArray(raw) || raw.length % 2) return false;
  for (let index = 0; index < raw.length; index += 2) {
    const name = raw[index].toLowerCase();
    if (name === 'x-authentik-uid') { identities++; uid = raw[index + 1]; }
    else if (name === 'host') hosts++;
    else if (name === 'origin') origins++;
    else if (name === 'cookie') cookies++;
  }
  // Do not allow Node's duplicate-header coalescing to change identity/trust semantics.
  return hosts === 1 && origins <= 1 && cookies <= 1 && identities === 1 && typeof uid === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(uid) && config.allowedUIDs.has(uid) && request.headers['x-authentik-uid'] === uid;
}
function nativeCookie(connection, request) {
  let status;
  let cookies;
  let ended = false;
  const authenticated = new URL(connection.authenticatedUrl('http://dsh.invalid/'));
  if (authenticated.pathname !== '/' || !authenticated.search) throw new Error('SSO: native authenticated URL contract mismatch');
  const capture = {
    writeHead(code, headers = {}) {
      if (status !== undefined) throw new Error('SSO: repeated native response');
      status = code;
      cookies = headers['set-cookie'];
    },
    end() { ended = true; },
  };
  const result = connection.authorizeIndex({ method: 'GET', url: authenticated.pathname + authenticated.search, headers: request.headers }, capture);
  if (result !== false || status !== 303 || !ended || typeof cookies !== 'string' || /[\r\n]/.test(cookies) || !cookies.includes('=')) throw new Error('SSO: native cookie exchange contract mismatch');
  const pair = cookies.split(';', 1)[0];
  const name = pair.slice(0, pair.indexOf('='));
  const previous = request.headers.cookie;
  if (previous !== undefined && typeof previous !== 'string') throw new Error('SSO: invalid Cookie representation');
  const kept = (previous ?? '').split(';').map(value => value.trim()).filter(value => value && value.slice(0, value.indexOf('=')) !== name);
  kept.push(pair);
  request.headers.cookie = kept.join('; ');
  if (connection.requestRejection(request) !== undefined) throw new Error('SSO: native cookie admission failed');
  return cookies;
}
function appendCookie(response, cookie) {
  // appendHeader preserves other Set-Cookie values without comma folding.
  response.appendHeader('set-cookie', cookie);
}
function reject(target, kind, status) {
  if (kind === 'http') {
    target.writeHead(status, { 'cache-control': 'no-store', 'connection': 'close', 'content-type': 'text/plain; charset=utf-8' });
    target.end('access denied\n');
  } else {
    target.end(`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Unauthorized'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => target.destroy());
  }
  return false;
}
export function createAdmission(connection, config, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  for (const method of ['requestRejection', 'authorizeIndex', 'authenticatedUrl']) if (typeof connection?.[method] !== 'function') throw new Error(`SSO: missing native Connection.${method}`);
  let disposed = false;
  const sockets = new Map();
  function admit(kind, request, target) {
    if (disposed || !externalIdentity(request, config)) return reject(target, kind, 403);
    const rejection = connection.requestRejection(request);
    if (rejection !== undefined && rejection !== 401 && rejection !== 403) throw new Error('SSO: native rejection contract mismatch');
    if (rejection === 403) return reject(target, kind, 403);
    // Only synthesize an internal root GET after the native Host/Origin fence accepted.
    const cookie = rejection === 401 ? nativeCookie(connection, request) : undefined;
    if (kind === 'http' && cookie) appendCookie(target, cookie);
    if (kind === 'upgrade') {
      // The handshake owner retains all framing/Set-Cookie behavior. The internally
      // admitted credential is request-local; a clean HTTP request persists it.
      if (!sockets.has(target)) {
        const timer = setTimer(() => target.destroy(), config.maxConnectionMilliseconds);
        timer.unref?.();
        const cleanup = () => { clearTimer(timer); sockets.delete(target); };
        sockets.set(target, cleanup);
        target.once('close', cleanup);
      }
    }
    return true;
  }
  return {
    http: (request, response) => admit('http', request, response),
    upgrade: (request, socket) => admit('upgrade', request, socket),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [socket, cleanup] of sockets) { cleanup(); socket.off('close', cleanup); socket.destroy(); }
    },
  };
}
