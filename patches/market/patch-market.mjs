// Applies a bounded patch to dshmarket (MIT); see NOTICE and its bundled LICENSE.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const originalHash = '42b100c26f0d1cec96232304d65bc8eabaf07a90f4ec2d10c7771f3d013f9258';
const patchedHash = '820abe8f053c23bb0aa4d532903bff4a7e46141463588df17beb4784fef05d51';
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
  if (manifest.name !== 'dshmarket' || manifest.version !== '1.66.44') {
    throw new Error('Unsupported market release: the managed runtime requires dshmarket 1.66.44');
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
