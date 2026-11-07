import { readdir, lstat, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';

const runtime = '/opt/dsh/runtime/node_modules/@deepseek-ai';
const source = '/opt/apps/dsh-tavern/node_modules/@deepseek-ai';
// The upstream frozen source lock remains intact. Linked Tavern code resolves
// its official peers through this tree, so expose the complete patched runtime
// closure here. Otherwise Node follows the symlink's realpath and cannot see
// the profile-level override links (for example dsh-tools or schemastery).
const runtimeNames = await readdir(runtime);
for (const name of await readdir(source)) {
  if (!runtimeNames.includes(name)) throw new Error(`Tavern requires an official module absent from pinned runtime: ${name}`);
}
for (const name of runtimeNames) {
  await rm(join(source, name), { recursive: true, force: true });
  await symlink(join(runtime, name), join(source, name));
}
// dsh-asset-library imports sharp lazily for SVG/thumbnail decoding. The
// upstream lock links that package without installing its native dependency,
// so expose the runtime-pinned sharp copy from the Tavern source tree.
const runtimeRoot = '/opt/dsh/runtime/node_modules';
const sourceRoot = '/opt/apps/dsh-tavern/node_modules';
for (const name of ['sharp']) {
  await rm(join(sourceRoot, name), { recursive: true, force: true });
  await symlink(join(runtimeRoot, name), join(sourceRoot, name));
}
