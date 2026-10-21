import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// These are deliberately dist-tags, not version pins. They are resolved when
// the image is built and are not recorded in versions.json or Renovate. The
// published image digest is the reproducibility boundary for them.
export const floatingBundles = Object.freeze({
  web: Object.freeze(['dsh-context']),
  tavern: Object.freeze([]),
});

const runtime = '/opt/dsh/runtime/node_modules';
const linkSpec = name => `link:${runtime}/${name}`;

const manifestPath = profileDir => join(profileDir, 'package.json');

async function readManifest(profileDir) {
  return JSON.parse(await readFile(manifestPath(profileDir), 'utf8'));
}

export async function addFloatingBundles(profileDir, profile) {
  const names = floatingBundles[profile];
  if (!names) throw new Error(`Unknown profile: ${profile}`);
  const manifest = await readManifest(profileDir);
  manifest.dependencies ??= {};
  manifest.dsh ??= {};
  manifest.dsh.profile ??= {};
  manifest.dsh.profile.bundles ??= [];
  for (const name of names) {
    // The package was installed into the immutable runtime at build time from
    // npm latest. The profile only receives a link, so a state migration can
    // restore it without running pnpm or copying a registry tree.
    manifest.dependencies[name] = linkSpec(name);
    if (!manifest.dsh.profile.bundles.includes(name)) {
      manifest.dsh.profile.bundles.push(name);
    }
  }
  await writeFile(manifestPath(profileDir), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
}

export async function verifyFloatingBundles(profileDir, profile, dshVersion) {
  const names = floatingBundles[profile];
  if (!names) throw new Error(`Unknown profile: ${profile}`);
  const manifest = await readManifest(profileDir);
  const bundles = manifest.dsh?.profile?.bundles;
  if (!Array.isArray(bundles)) throw new Error(`Profile ${profile} has no bundle list`);
  for (const name of names) {
    if (manifest.dependencies?.[name] !== linkSpec(name)) {
      throw new Error(`${name} must resolve through the immutable runtime link`);
    }
    if (!bundles.includes(name)) throw new Error(`${name} is installed but not enabled as a bundle`);
    const installed = JSON.parse(await readFile(join(profileDir, 'node_modules', name, 'package.json'), 'utf8'));
    if (installed.name !== name) throw new Error(`Installed package identity mismatch for ${name}`);
    if (installed.dsh?.bundle === undefined) {
      throw new Error(`${name} no longer declares dsh.bundle; upstream drift must be reviewed`);
    }
    if (dshVersion) {
      const releases = installed.dsh?.compatibility?.dshReleases;
      if (releases && Object.keys(releases).length > 0 && !Object.hasOwn(releases, dshVersion)) {
        throw new Error(`${name} has no compatibility declaration for DSH ${dshVersion}`);
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, profile, profileDir] = process.argv.slice(2);
  const dshVersion = process.env.DSH_VERSION;
  if (!action || !profile || !profileDir) {
    throw new Error('Usage: floating-bundles.mjs <add|verify> <web|tavern> PROFILE_DIRECTORY');
  }
  if (action === 'add') await addFloatingBundles(profileDir, profile);
  else if (action === 'verify') await verifyFloatingBundles(profileDir, profile, dshVersion);
  else throw new Error(`Unknown action: ${action}`);
}
