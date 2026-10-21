import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function patchRoutes(text, expectedHash) {
  const hash = createHash('sha256').update(text).digest('hex');
  if (hash !== expectedHash) throw new Error(`Tavern route source mismatch: ${hash}`);
  const anchor = '        const origin = req.headers.origin\n';
  const added = `${anchor}        // The raw SSO gate enforces peer/UID. Keep the public-Origin fence\n        // independent: neither forwarded headers nor an arbitrary Host grant it.\n        let trustedPublicOrigin = false\n        try {\n          const publicUrl = new URL(process.env.DSH_PUBLIC_URL)\n          trustedPublicOrigin = typeof origin === 'string' && origin === publicUrl.origin\n            && req.headers.host === publicUrl.host\n            && req.headers['sec-fetch-site'] !== 'cross-site'\n        } catch {}\n`;
  if (text.split(anchor).length !== 2) throw new Error('Tavern Origin anchor changed');
  text = text.replace(anchor, added);
  const staticGuard = 'if (readsStaticAsset && !localOrOpaqueOrigin) {';
  const genericGuard = 'if (!readsCachedAsset && !readsStaticAsset && !readsOfficialMvu && !readsFullTemplate && !readsRuntimeAsset && !readsClientAsset && !readsPluginAsset && !sceneSameOrigin && typeof origin';
  if (!text.includes(staticGuard) || !text.includes(genericGuard)) throw new Error('Tavern route guards changed');
  return text.replace(staticGuard, 'if (readsStaticAsset && !localOrOpaqueOrigin && !trustedPublicOrigin) {')
    .replace(genericGuard, genericGuard.replace('&& typeof origin', '&& !trustedPublicOrigin && typeof origin'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = '/opt/dsh-tavern/apps/dsh-tavern';
  const versions = JSON.parse(await readFile(new URL('../../versions.json', import.meta.url), 'utf8'));
  const file = join(source, 'tavern-plugin/lib/http/routes.js');
  await writeFile(file, patchRoutes(await readFile(file, 'utf8'), versions.tavern.routesSha256));
  const { patchThemeFontLimit } = await import(`${source}/bin/theme-font-limit.mjs`);
  patchThemeFontLimit('/opt/dsh/runtime/node_modules/@deepseek-ai/dsh-client-ui-theme');
}
