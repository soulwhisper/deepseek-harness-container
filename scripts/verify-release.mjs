// Trusted release only. Validate the tag and record the already-created
// multi-arch OCI index. The per-architecture manifests were built and smoked
// on native runners; this script never rebuilds or re-tags them.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mode = process.argv[2];
const requested = process.argv[3];
const repository = 'soulwhisper/deepseek-harness-container';
const sha = process.env.GITHUB_SHA;
const versions = JSON.parse(await readFile(new URL('../versions.json', import.meta.url), 'utf8'));
const releases = {
  web: { tag: versions.release.web.tag, version: versions.distribution },
  tavern: { tag: versions.release.tavern.tag, version: versions.tavern.version },
};
if (process.env.GITHUB_REPOSITORY !== repository || !/^[a-f0-9]{40}$/u.test(sha ?? '')
  || !['check', 'record'].includes(mode) || !Object.hasOwn(releases, requested)) {
  throw new Error('Release requires the trusted repository, exact commit and target');
}
const imageName = target => `${versions.registry}/${versions.release[target].image}`;
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', APP_PRIVATE_KEY: '' } });
  if (result.status !== 0 || result.error) {
    throw new Error(`${command} operation failed; credential-bearing output withheld`);
  }
  return result;
}
function inspect(image) {
  // The combine job has already authenticated Docker to GHCR. Reuse that
  // registry client instead of constructing a second Basic-auth token request.
  const { stdout } = run('docker', ['buildx', 'imagetools', 'inspect', '--format', '{{json .Manifest}}', image]);
  let manifest;
  try { manifest = JSON.parse(stdout); } catch { throw new Error('Registry inspection returned invalid metadata'); }
  const value = manifest?.digest;
  if (!/^sha256:[a-f0-9]{64}$/u.test(value ?? '')) throw new Error('Registry inspection did not return an index digest');
  return value;
}
const { tag, version } = releases[requested];
if (process.env.GITHUB_REF !== `refs/tags/${tag}`) {
  throw new Error(`Release tag ${tag} must match versions.json exactly`);
}
run('git', ['merge-base', '--is-ancestor', sha, 'origin/main']);
if (mode === 'check') {
  console.log(`release route ok: ${tag} -> ${imageName(requested)}:${version}`);
} else {
  const expected = process.env.IMAGE_DIGEST;
  if (!/^sha256:[a-f0-9]{64}$/.test(expected ?? '')) throw new Error('Missing published index digest');
  const image = imageName(requested);
  if (await inspect(`${image}:${version}`) !== expected) throw new Error('Published index digest changed');
  const notes = ['Self-packaged DSH distribution; upstream remains a developer preview.', '',
    `Release tag: ${tag}`,
    `Image: ${image}:${version}`,
    'Native linux/amd64 and linux/arm64 images were built and final-image smoked on their own runners before the index was created.',
    'OCI index references the two tested architecture manifests; it is not a security audit.', '',
    'Immutable image:', `- ${image}@${expected}`];
  if (requested === 'tavern') {
    notes.push('', 'Tavern source and AGPL-3.0 license are included in the image; see NOTICE and READMEs.');
  }
  notes.push('', `Source: https://github.com/${repository}/tree/${sha}`);
  await writeFile(join(process.env.RUNNER_TEMP ?? tmpdir(), 'dsh-release-notes.txt'), `${notes.join('\n')}\n`, { mode: 0o600 });
  console.log(`${requested}: ${expected}`);
}
