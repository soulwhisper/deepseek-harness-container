// Applies a bounded patch to dshmarket (MIT); see NOTICE and its bundled LICENSE.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const version = '1.73.5';
const originalHash = '951b2fffa7dc8d0498bed7120d9e3c7dbec61a32f72c1b88f477e9feef8ef534';
const patchedHash = 'ecd8e98b637292bcf17c0085ef9ed2f0819518114b8b09ebef4e5279b2cebc1f';
const original = `            host.effect(() => {
                const restoreTrustedHosts = useTrustedHosts(ctx);
                const disposeRoutes = mountMarketRoutes(host, resolved, undefined, agentsLookupOf(ctx));
                return () => {
                    disposeRoutes();
                    restoreTrustedHosts();
                };
            }, 'dsh-market: http routes');`;
const replacement = `            host.effect(() => {
                // The distribution owns package admission; never bypass it via a CLI subprocess.
                const runtime = createOfficialDesktopRuntime(() => hostCtx.get('pluginManager'), resolved.profile, resolved.profileDirectory);
                const restoreTrustedHosts = useTrustedHosts(ctx);
                const disposeRoutes = mountMarketRoutes(host, resolved, runtime, agentsLookupOf(ctx));
                return async () => {
                    disposeRoutes();
                    restoreTrustedHosts();
                    await runtime.dispose();
                };
            }, 'dsh-market: managed Web routes');`;
const digest = source => createHash('sha256').update(source).digest('hex');

export async function patchMarket(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (manifest.name !== 'dshmarket' || manifest.version !== version) {
    throw new Error(`Unsupported market release: the managed runtime requires dshmarket ${version}`);
  }
  const path = join(directory, 'lib/index.js');
  const source = await readFile(path, 'utf8');
  const hash = digest(source);
  if (hash === patchedHash) return;
  if (hash !== originalHash || source.split(original).length !== 2) {
    throw new Error('Market artifact differs from the reviewed release; refusing an unverified patch');
  }
  const patched = source.replace(original, replacement);
  if (digest(patched) !== patchedHash) throw new Error('Managed market patch identity mismatch');
  await writeFile(path, patched);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: patch-market.mjs MARKET_DIRECTORY');
  await patchMarket(resolve(process.argv[2]));
}
