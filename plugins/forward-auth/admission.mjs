// SPDX-License-Identifier: Apache-2.0
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

const SUBJECT_PATTERN = /^[A-Za-z0-9._:@+-]{1,256}$/u;
const HEADER_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const RESERVED_HEADERS = new Set([
  'authorization', 'connection', 'content-length', 'cookie', 'host', 'origin',
  'transfer-encoding', 'upgrade',
]);

function list(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`forward-auth: ${field} is mandatory`);
  const values = value.split(',').map(item => item.trim());
  if (values.some(item => !item) || new Set(values).size !== values.length) throw new Error(`forward-auth: invalid ${field}`);
  return values;
}
function headerName(value) {
  if (typeof value !== 'string' || !HEADER_PATTERN.test(value)) throw new Error('forward-auth: DSH_FORWARD_AUTH_HEADER is mandatory or invalid');
  const name = value.toLowerCase();
  if (RESERVED_HEADERS.has(name)) throw new Error(`forward-auth: DSH_FORWARD_AUTH_HEADER cannot be ${name}`);
  return name;
}
function address(value) {
  if (!value || !isIP(value) || value.includes('%')) return undefined;
  const parsed = ipaddr.parse(value);
  return parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress() ? parsed.toIPv4Address() : parsed;
}
function hasUpstreamToken(request) {
  if (typeof request?.url !== 'string') return false;
  try {
    return new URL(request.url, 'http://dsh.invalid').searchParams.has('token');
  } catch {
    return true;
  }
}
export function configuration(env = process.env) {
  const header = headerName(env.DSH_FORWARD_AUTH_HEADER);
  const allowedSubjects = new Set(list(env.DSH_FORWARD_AUTH_ALLOWED_SUBJECTS, 'DSH_FORWARD_AUTH_ALLOWED_SUBJECTS'));
  for (const subject of allowedSubjects) {
    if (!SUBJECT_PATTERN.test(subject)) throw new Error('forward-auth: invalid allowed subject');
  }
  const proxyCIDRs = list(env.DSH_FORWARD_AUTH_TRUSTED_PROXY_CIDRS, 'DSH_FORWARD_AUTH_TRUSTED_PROXY_CIDRS').map(value => {
    const parts = value.split('/');
    const ip = address(parts[0]);
    if (parts.length !== 2 || !ip || !/^(0|[1-9]\d*)$/.test(parts[1])) throw new Error('forward-auth: trusted proxies must be explicit IP CIDRs');
    const prefix = Number(parts[1]);
    // Mapped CIDR notation is ambiguous after normalization: require native IPv4 CIDRs.
    if (isIP(parts[0]) === 6 && ip.kind() === 'ipv4' || prefix > (ip.kind() === 'ipv4' ? 32 : 128)) throw new Error('forward-auth: invalid trusted proxy CIDR');
    return [ip, prefix];
  });
  const rawSeconds = env.DSH_FORWARD_AUTH_MAX_CONNECTION_SECONDS ?? '900';
  if (!/^[1-9]\d*$/.test(rawSeconds)) throw new Error('forward-auth: invalid maximum connection seconds');
  const seconds = Number(rawSeconds);
  if (!Number.isSafeInteger(seconds) || seconds * 1000 > 2 ** 31 - 1) throw new Error('forward-auth: maximum connection seconds exceeds timer range');
  return { header, allowedSubjects, proxyCIDRs, maxConnectionMilliseconds: seconds * 1000 };
}
/**
 * Return a fixed denial category, or undefined when the request is admitted.
 * No identity value is returned so callers can log without leaking subjects.
 */
export function identityFailure(request, config) {
  if (hasUpstreamToken(request)) return 'upstream-token';
  const peer = address(request?.socket?.remoteAddress);
  if (!peer || !config.proxyCIDRs.some(([network, prefix]) => peer.kind() === network.kind() && peer.match(network, prefix))) return 'untrusted-peer';
  let identity;
  let identities = 0;
  let hosts = 0;
  let origins = 0;
  let cookies = 0;
  const raw = request.rawHeaders;
  if (!Array.isArray(raw) || raw.length % 2) return 'invalid-request';
  for (let index = 0; index < raw.length; index += 2) {
    const name = raw[index].toLowerCase();
    if (name === config.header) { identities++; identity = raw[index + 1]; }
    else if (name === 'host') hosts++;
    else if (name === 'origin') origins++;
    else if (name === 'cookie') cookies++;
  }
  if (hosts !== 1) return 'invalid-host';
  if (origins > 1) return 'duplicate-origin';
  if (cookies > 1) return 'duplicate-cookie';
  if (identities === 0) return 'missing-identity';
  // Do not allow Node's duplicate-header coalescing to change identity/trust semantics.
  if (identities > 1) return 'duplicate-identity';
  if (typeof identity !== 'string' || !SUBJECT_PATTERN.test(identity)) return 'invalid-subject';
  if (!config.allowedSubjects.has(identity)) return 'unknown-subject';
  if (request.headers?.[config.header] !== identity) return 'identity-mismatch';
  return undefined;
}
export function externalIdentity(request, config) {
  return identityFailure(request, config) === undefined;
}
function nativeCookie(connection, request) {
  let status;
  let cookies;
  let ended = false;
  const authenticated = new URL(connection.authenticatedUrl('http://dsh.invalid/'));
  if (authenticated.pathname !== '/' || !authenticated.search) throw new Error('forward-auth: native authenticated URL contract mismatch');
  const capture = {
    writeHead(code, headers = {}) {
      if (status !== undefined) throw new Error('forward-auth: repeated native response');
      status = code;
      cookies = headers['set-cookie'];
    },
    end() { ended = true; },
  };
  const result = connection.authorizeIndex({ method: 'GET', url: authenticated.pathname + authenticated.search, headers: request.headers }, capture);
  if (result !== false || status !== 303 || !ended || typeof cookies !== 'string' || /[\r\n]/.test(cookies) || !cookies.includes('=')) throw new Error('forward-auth: native cookie exchange contract mismatch');
  const pair = cookies.split(';', 1)[0];
  const name = pair.slice(0, pair.indexOf('='));
  const previous = request.headers.cookie;
  if (previous !== undefined && typeof previous !== 'string') throw new Error('forward-auth: invalid Cookie representation');
  const kept = (previous ?? '').split(';').map(value => value.trim()).filter(value => value && value.slice(0, value.indexOf('=')) !== name);
  kept.push(pair);
  request.headers.cookie = kept.join('; ');
  if (connection.requestRejection(request) !== undefined) throw new Error('forward-auth: native cookie admission failed');
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
export function createAdmission(connection, config, { setTimer = setTimeout, clearTimer = clearTimeout, report = () => {} } = {}) {
  for (const method of ['requestRejection', 'authorizeIndex', 'authenticatedUrl']) if (typeof connection?.[method] !== 'function') throw new Error(`forward-auth: missing native Connection.${method}`);
  let disposed = false;
  let active = false;
  const sockets = new Map();
  const notify = event => { try { report(event); } catch { /* status reporting must not affect admission */ } };
  function deny(reason, target, kind) {
    notify({ type: 'denied', reason });
    return reject(target, kind, 403);
  }
  function admit(kind, request, target) {
    if (disposed) return deny('disposed', target, kind);
    const failure = identityFailure(request, config);
    if (failure) return deny(failure, target, kind);
    let rejection;
    try {
      rejection = connection.requestRejection(request);
    } catch (error) {
      notify({ type: 'broken', reason: 'native-rejection' });
      throw error;
    }
    if (rejection !== undefined && rejection !== 401 && rejection !== 403) {
      notify({ type: 'broken', reason: 'native-rejection-contract' });
      throw new Error('forward-auth: native rejection contract mismatch');
    }
    if (rejection === 403) return deny('native-fence', target, kind);
    let cookie;
    try {
      // Only synthesize an internal root GET after the native Host/Origin fence accepted.
      cookie = rejection === 401 ? nativeCookie(connection, request) : undefined;
      if (kind === 'http' && cookie) appendCookie(target, cookie);
      if (kind === 'upgrade' && !sockets.has(target)) {
        // The handshake owner retains all framing/Set-Cookie behavior. The internally
        // admitted credential is request-local; a clean HTTP request persists it.
        const timer = setTimer(() => target.destroy(), config.maxConnectionMilliseconds);
        timer.unref?.();
        const cleanup = () => { clearTimer(timer); sockets.delete(target); };
        sockets.set(target, cleanup);
        target.once('close', cleanup);
      }
    } catch (error) {
      notify({ type: 'broken', reason: 'native-cookie' });
      throw error;
    }
    if (!active) {
      active = true;
      notify({ type: 'active' });
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
