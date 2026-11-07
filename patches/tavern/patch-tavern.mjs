import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verifyTheme(directory, expected) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (manifest.name !== expected.package || manifest.version !== expected.version) {
    throw new Error(`Tavern theme package mismatch: ${manifest.name}@${manifest.version}; expected ${expected.package}@${expected.version}`);
  }
  for (const [name, expectedHash] of [['lib/index.js', expected.indexSha256], ['lib/client.js', expected.clientSha256]]) {
    const text = await readFile(join(directory, name), 'utf8');
    const hash = createHash('sha256').update(text).digest('hex');
    if (hash !== expectedHash) throw new Error(`Tavern theme source mismatch: ${name} ${hash}`);
  }
}

// Tavern 3.2 already rejects cross-origin calls in its route gate. The
// distribution claims no route modification: it pins the exact upstream file
// and verifies the gate plus the paid/capability same-origin checks are still
// present. A hash or anchor mismatch is a build failure.
export function verifyRoutes(text, expectedHash) {
  const hash = createHash('sha256').update(text).digest('hex');
  if (hash !== expectedHash) throw new Error(`Tavern route source mismatch: ${hash}`);
  const gates = [
    "        const sameOrigin = origin === 'http://' + req.headers.host || origin === 'https://' + req.headers.host\n",
    "        if (origin && !sameOrigin && !(cookieFree && origin === 'null')) {\n",
    "        if ((figureVoiceRoute || assetGenerationRoute) && (!sameOrigin || req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {\n",
  ];
  for (const gate of gates) {
    if (text.split(gate).length !== 2) {
      throw new Error(`Tavern route gate changed: ${gate.trim()}`);
    }
  }
  return text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = '/opt/apps/dsh-tavern';
  const versions = JSON.parse(await readFile(new URL('../../versions.json', import.meta.url), 'utf8'));
  const file = join(source, 'tavern-plugin/lib/http/routes.js');
  const theme = '/opt/dsh/runtime/node_modules/@deepseek-ai/dsh-client-ui-theme';
  await verifyTheme(theme, versions.tavern.theme);
  verifyRoutes(await readFile(file, 'utf8'), versions.tavern.routesSha256);
  // Upstream's profile installer calls this helper after installing the host
  // theme. This image builds the profile itself, so apply the same upstream
  // step here instead of running bin/profile-installation.mjs.
  const { patchThemeFontLimit } = await import(`${source}/bin/theme-font-limit.mjs`);
  if (patchThemeFontLimit(theme) === null) throw new Error('Tavern theme helper declined the pinned theme version');
}
