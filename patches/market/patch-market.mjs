// Applies a bounded patch to dshmarket (MIT); see NOTICE and its bundled LICENSE.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const version = '1.73.12';
const originalHash = '3c7a9717144a1b50c3196e640b7bff0673c84862ba411067e1a3501d5ed2f2fb';
const patchedHash = '1bdecdc5fb6e52933f848c6107c177636951fbdee04d8fc51e22b4df9cff80b9';
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
                const runtime = createOfficialDesktopRuntime(() => hostCtx.get('pluginManager'), resolved.profile, resolved.profileDirectory, hostPackageManagerOf(profileContext));
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
