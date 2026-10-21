// Streamed into the final image by CI. Prints the native loader attempts so a
// missing/misresolved prebuilt is actionable without exposing app data.
import { createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

if (process.env.NARB_DISABLE_NATIVE_CACHE !== '1') throw new Error('NARB_DISABLE_NATIVE_CACHE must be 1 for noexec /tmp');
const runtime = '/opt/dsh/docker/runtime';
const requireRuntime = createRequire(join(runtime, 'package.json'));
const suffix = process.arch === 'arm64' ? 'linux-arm64-gnu' : 'linux-x64-gnu';
const optional = `node-addon-require-builtin-${suffix}`;
const optionalDir = join(runtime, 'node_modules', optional);

console.log('architecture', process.arch);
console.log('optional dir', optionalDir);
try {
  console.log(await readdir(optionalDir));
} catch (error) {
  console.error('optional package missing', error.code ?? error.message);
  process.exit(1);
}

const requireNative = createRequire(join(runtime, 'node_modules/node-addon-require-builtin/package.json'));
try {
  console.log('resolved', requireNative.resolve(optional));
} catch (error) {
  console.error('optional package not resolvable by name', error.code ?? error.message);
  process.exit(1);
}

const loader = requireNative('node-addon-native-custom-loader');
try {
  const entry = loader.createEntryApi(join(runtime, 'node_modules/node-addon-require-builtin'));
  console.log('entry api ok', entry.getBindingInfo());
} catch (error) {
  console.error('entry api failed', error.message);
  console.error(JSON.stringify(error.attempts ?? null, null, 2));
  process.exit(1);
}
