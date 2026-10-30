// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gateMembers, gateDeclarations, gateClassDeclarations } from './host-gate.mjs';

const rc2Hashes = Object.freeze({
  host: '08907285802f0edd3aeb68c91fb443be2804879ab3d41104c4600424be06f3ab',
  types: '44d66c97017d07239be332ac37183f3fa79a2b49aa4628ca06ad76c112839d1b',
  manager: '1b8bf9eb266d7b3b7f899175e3f435c89ed8baa8aabc677212759f8c6cd23132',
  boot: '5135179ac810e4f626f32ec3bdc3293dc7d2028e8aa92e5e0c006f1a33b78e76',
});
// The Web image follows the alpha line. Keep exact hashes per release; a
// new alpha still requires a deliberate adapter, not an anchor-only guess.
const alphaHashes = Object.freeze({
  host: '81a85ab619d8977e090e23124fd4e0e135c944c99b8b199eadea615532f2b2e3',
  types: '09b09157e6187d0d12270549a2564dc7f392fb617b3c9617d3b4f72ddad5c87d',
  manager: '2aa5aa509376fb4cf1fb344a19076b61c8eb30c0f836c1f3dd1729ed23f7464e',
  boot: 'dbe13b8cbfe6a183efab4cb363bbcbc35e4ee171b5f8c798390d0371ca9ea4ff',
});
const hashSets = Object.freeze({ '0.2.1-rc.2': rc2Hashes, '0.2.2-alpha.2': alphaHashes });
export const upstreamVersion = '0.2.1-rc.2';
export const sourceHashes = rc2Hashes;
export const supportedVersions = Object.freeze(Object.keys(hashSets));
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('forward-auth patch: upstream structure mismatch');
  return source.replace(before, after);
}
function patchManagerAlpha(source) {
  source = replaceOnce(source, '\t\t\tthis.profile = ctx.profileContext;', '\t\t\tthis.profile = ctx.profileContext;\n\t\t\tPROTECTED_PLUGINS.add("@soulwhisper/dsh-forward-auth");\n\t\t\tPROTECTED_PLUGINS.add("@deepseek-ai/dsh-app-boot");\n\t\t\tfor (const name of readProfileManifest("dsh", this.profile.dir).dshTavern?.managedDependencies ?? []) PROTECTED_PLUGINS.add(name);');
  source = replaceOnce(source, '\t\tprotectsManager(name) {', '\t\tprotectsManager(name) {\n\t\t\tif (name === "@soulwhisper/dsh-forward-auth") return true;\n\t\t\tconst tavernBundles = readProfileManifest("dsh", this.profile.dir).dshTavern?.managedBundles;\n\t\t\tif (Array.isArray(tavernBundles) && tavernBundles.includes(name)) return true;');
  source = replaceOnce(source, 'const known = specPackageName(spec, before, this.profile.dir);', 'const known = specPackageName(spec, before, this.profile.dir);\n\t\t\t\tif (known !== undefined && this.protectsManager(known)) throw new ManagementFailure("management-required");');
  return source;
}
export function patchSource(kind, source, version = upstreamVersion) {
  const hashes = hashSets[version];
  if (!hashes) throw new Error(`forward-auth patch: unsupported DSH ${version}`);
  if (createHash('sha256').update(source).digest('hex') !== hashes[kind]) throw new Error(`forward-auth patch: ${kind} exact source hash mismatch`);
  if (kind === 'types') {
    source = replaceOnce(source, 'export declare class WebServer extends Service {', 'export declare class WebServer extends Service {' + gateClassDeclarations);
    source = replaceOnce(source, 'export default WebServer;', gateDeclarations + '\nexport default WebServer;');
  } else if (kind === 'boot') {
    source = replaceOnce(source, 'const requiredStartupEntryIds = new Set([', 'const requiredStartupEntryIds = new Set([\n\t"distribution-forward-auth",');
    source = replaceOnce(source, '\t\tawait auditStartupEntries(ctx, binName);\n\t\treturn ctx;', '\t\tawait auditStartupEntries(ctx, binName);\n\t\tctx.provide("distributionStartupReady", true);\n\t\treturn ctx;');
  } else if (kind === 'manager') {
    if (version === '0.2.2-alpha.2') source = patchManagerAlpha(source);
    else {
      source = replaceOnce(source, 'const protectedModules = new Set([', 'const protectedModules = new Set([\n\t"@soulwhisper/dsh-forward-auth",\n\t"@deepseek-ai/dsh-app-boot",');
      source = replaceOnce(source, '\t\t\tthis.profile = ctx.profileContext;', '\t\t\tthis.profile = ctx.profileContext;\n\t\t\tfor (const name of readProfileManifest("dsh", this.profile.dir).dshTavern?.managedDependencies ?? []) protectedModules.add(name);');
      source = replaceOnce(source, 'protectsManager(name) {', 'protectsManager(name) {\n\t\t\tif (name === "@soulwhisper/dsh-forward-auth") return true;\n\t\t\tconst tavernBundles = readProfileManifest("dsh", this.profile.dir).dshTavern?.managedBundles;\n\t\t\tif (Array.isArray(tavernBundles) && tavernBundles.includes(name)) return true;');
      source = replaceOnce(source, 'const known = specPackageName(spec, before, this.profile.dir);', 'const known = specPackageName(spec, before, this.profile.dir);\n\t\t\t\tif (known !== undefined && protectedModules.has(known)) throw new ManagementFailure("management-required");');
    }
  } else if (kind === 'host') {
    source = replaceOnce(source, '\tconfig;\n\tstatic Config', '\tconfig;\n' + gateMembers + '\n\tstatic Config');
    source = replaceOnce(source, '\t\tconst handle = async (req, res) => {', '\t\tconst handle = async (req, res) => {\n\t\t\tif (!this.runRequiredAccessGate("http", req, res)) return;');
    source = replaceOnce(source, '\t\t\tthis.server.on("upgrade", (req, socket, head) => {', '\t\t\tthis.server.on("connection", (socket) => {\n\t\t\t\tthis.requiredAccessSockets.add(socket);\n\t\t\t\tsocket.once("close", () => this.requiredAccessSockets.delete(socket));\n\t\t\t});\n\t\t\tthis.server.on("upgrade", (req, socket, head) => {');
    source = replaceOnce(source, '\t\t\t\tlet route;', '\t\t\t\tif (!this.runRequiredAccessGate("upgrade", req, socket)) return;\n\t\t\t\tlet route;');
    source = replaceOnce(source, '\t\t\treturn async () => {\n\t\t\t\tconst serverClosed', '\t\t\treturn async () => {\n\t\t\t\tthis.requiredAccessGate = undefined;\n\t\t\t\tfor (const socket of this.requiredAccessSockets) socket.destroy();\n\t\t\t\tconst serverClosed');
  } else throw new Error('forward-auth patch: unknown source kind');
  return source;
}

// Visit pnpm store package roots and their symlink aliases once, not application sources.
async function packageRoots(nodeModules, found = new Set(), seen = new Set()) {
  let canonical;
  try { canonical = await realpath(nodeModules); } catch (error) { if (error.code === 'ENOENT') return found; throw error; }
  if (seen.has(canonical)) return found;
  seen.add(canonical);
  for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const path = join(nodeModules, entry.name);
    if (entry.name === '.pnpm') {
      for (const item of await readdir(path, { withFileTypes: true })) if (item.isDirectory()) await packageRoots(join(path, item.name, 'node_modules'), found, seen);
    } else if (entry.name.startsWith('@')) {
      for (const item of await readdir(path)) {
        const root = await realpath(join(path, item));
        found.add(root);
        await packageRoots(join(root, 'node_modules'), found, seen);
      }
    } else if (!entry.name.startsWith('.')) {
      const root = await realpath(path);
      found.add(root);
      await packageRoots(join(root, 'node_modules'), found, seen);
    }
  }
  return found;
}
export async function patchInstallation(runtime) {
  const pending = [];
  const counts = { host: 0, manager: 0, boot: 0 };
  const versions = new Set();
  const selected = [];
  for (const root of await packageRoots(join(resolve(runtime), 'node_modules'))) {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const kind = manifest.name === '@deepseek-ai/dsh-host-webserver' ? 'host' : manifest.name === '@deepseek-ai/dsh-plugin-manager' ? 'manager' : manifest.name === '@deepseek-ai/dsh-app-boot' ? 'boot' : undefined;
    if (!kind) continue;
    if (!hashSets[manifest.version]) throw new Error(`forward-auth patch: unsupported ${manifest.name} version ${manifest.version}`);
    versions.add(manifest.version);
    if (versions.size > 1) throw new Error('forward-auth patch: host, manager and app-boot must come from one DSH runtime version');
    selected.push({ manifest, kind, root });
  }
  if (!selected.some(item => item.kind === 'host') || !selected.some(item => item.kind === 'manager') || !selected.some(item => item.kind === 'boot')) throw new Error('forward-auth patch: required host/manager/app-boot packages not found');
  for (const { manifest, kind, root } of selected) {
    counts[kind]++;
    for (const [fileKind, path] of [[kind, join(root, 'lib/index.js')], ...(kind === 'host' ? [['types', join(root, 'lib/types/index.d.ts')]] : [])]) {
      pending.push([path, patchSource(fileKind, await readFile(path, 'utf8'), manifest.version)]);
    }
  }
  // Validate every package before writing any package. Never accept an unknown/already patched input.
  for (const [path, content] of pending) await writeFile(path, content);
  return counts;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node patch-host.mjs RUNTIME_DIRECTORY');
  console.log('forward-auth required gate installed:', await patchInstallation(process.argv[2]));
}
