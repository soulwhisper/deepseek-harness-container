import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Tavern installs its bundled scene-image plugin into user data on first
// install. The container builds the profile itself, so mirror that one upstream
// step after state materialization. The installer is idempotent: an existing
// target or a profile-installed dsh-tavern-image wins.
const home = process.env.DSH_HOME ?? '/data/dsh';
const profile = process.env.DSH_PROFILE ?? 'web';
if (profile === 'tavern') {
  const sourceRoot = '/opt/apps/dsh-tavern';
  const installer = join(sourceRoot, 'bin', 'bundled-scene-image-plugin.mjs');
  if (!existsSync(installer)) {
    console.warn('tavern: bundled scene-image installer is missing from the image');
  } else {
    const { installBundledSceneImagePlugin } = await import(pathToFileURL(installer).href);
    try {
      const result = installBundledSceneImagePlugin({
        sourceRoot,
        dataRoot: join(home, 'profile-data/tavern/data'),
        profileDir: join(home, 'profiles/tavern'),
      });
      if (result.action === 'installed') console.error(`tavern: installed bundled dsh-tavern-image ${result.version}`);
      else if (result.action === 'unavailable') console.warn(`tavern: bundled dsh-tavern-image unavailable: ${result.reason}`);
    } catch (error) {
      // Tavern itself treats a failed bundled install as non-fatal.
      console.warn(`tavern: bundled dsh-tavern-image failed: ${error?.message ?? error}`);
    }
  }
}
