import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const versions = JSON.parse(await readFile(join(root, 'versions.json'), 'utf8'));
const seed = process.env.DSH_SEED_DIR ?? '/opt/dsh-seed';
const runtime = '/opt/dsh/runtime';
const source = '/opt/dsh-tavern/apps/dsh-tavern';
const YAML = createRequire(join(runtime, 'package.json'))('yaml');
const base = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@soulwhisper/dsh-forward-auth'];
const link = name => `link:${runtime}/node_modules/${name}`;
// Override the existing official closure, not arbitrary user packages. Every
// protected host module must resolve to the patched immutable runtime copy.
const overrides = {};
for (const name of await readdir(`${runtime}/node_modules/@deepseek-ai`)) {
  // Platform-specific native addon packages differ by architecture; keeping
  // them out of profile overrides makes the generated workspace identical on
  // amd64 and arm64. The base node-addon-system package stays protected.
  if (/-(?:linux|darwin|win32)-(?:x64|arm64|arm|ia32)$/u.test(name)) continue;
  overrides[`@deepseek-ai/${name}`] = link(`@deepseek-ai/${name}`);
}
overrides['@soulwhisper/dsh-forward-auth'] = link('@soulwhisper/dsh-forward-auth');
for (const profile of ['web', 'tavern'].filter(name => !process.env.DSH_BUILD_PROFILE || name === process.env.DSH_BUILD_PROFILE)) {
  const dir = join(seed, 'profiles', profile);
  await mkdir(dir, { recursive: true });
  const dependencies = Object.fromEntries(base.map(name => [name, link(name)]));
  const bundles = [...base];
  const manifest = {
    name: `dsh-profile-${profile}`, private: true,
    packageManager: `pnpm@${versions.pnpm}`,
    dependencies, dsh: { profile: { bundles } },
  };
  const workspace = YAML.parse(await readFile(join(root, 'profiles', profile, 'pnpm-workspace.yaml'), 'utf8'));
  workspace.overrides = overrides;
  if (profile === 'web') {
    dependencies.dshmarket = link('dshmarket');
    bundles.push('dshmarket');
    await writeFile(join(dir, 'cordis.patch.yml'), '[]\n');
  } else {
    dependencies['dsh-better-sidebar'] = '0.28.0';
    dependencies['dsh-dream-skin'] = `link:${source}/tavern-plugin/packages/dsh-dream-skin`;
    dependencies['dsh-tavern-plugin'] = `link:${source}/tavern-plugin`;
    dependencies['dsh-tavern-remote'] = `link:${source}/tavern-plugin/packages/dsh-tavern-remote`;
    Object.assign(dependencies, versions.ecosystem);
    bundles.push('dsh-better-sidebar', 'dsh-dream-skin', 'dsh-tavern-plugin', 'dsh-tavern-remote', ...Object.keys(versions.ecosystem));
    manifest.dshTavern = {
      source, dataRoot: '/data/dsh/profile-data/tavern/data', host: 'cli',
      dshVersion: versions.dsh.version, managedBundles: [...bundles],
      managedDependencies: Object.keys(dependencies), profileConfigurationVersion: 1,
    };
    await cp(`${source}/cordis.patch.yml`, join(dir, 'cordis.patch.yml'));
    await mkdir(join(dir, 'patches'), { recursive: true });
    await cp(`${source}/patches/dsh-better-sidebar@0.28.0.patch`, join(dir, 'patches/dsh-better-sidebar@0.28.0.patch'));
  }
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(dir, 'pnpm-workspace.yaml'), YAML.stringify(workspace));
}
await writeFile(join(seed, 'BUNDLED_VERSIONS'), JSON.stringify(versions, null, 2) + '\n');
