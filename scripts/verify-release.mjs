// Trusted release only. Validate the tag and record the already-created
// multi-arch OCI index. The per-architecture manifests were built and smoked
// on native runners; this script never rebuilds or re-tags them.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const mode = process.argv[2];
const requested = process.argv[3];
const repository = 'soulwhisper/deepseek-harness-container';
const sha = process.env.GITHUB_SHA;
const token = process.env.GITHUB_TOKEN;
const username = process.env.GHCR_USERNAME ?? 'x-access-token';
const versions = JSON.parse(await readFile(new URL('../versions.json', import.meta.url), 'utf8'));
const releases = {
  web: { tag: versions.release.web.tag, version: versions.dsh.version },
  tavern: { tag: versions.release.tavern.tag, version: versions.tavern.version },
};
if (process.env.GITHUB_REPOSITORY !== repository || !/^[a-f0-9]{40}$/u.test(sha ?? '')
  || !['check', 'record'].includes(mode) || !Object.hasOwn(releases, requested)
  || (mode === 'record' && !token)) {
  throw new Error('Release requires the trusted repository, exact commit, target and release token');
}
const imageName = target => `${versions.registry}/${versions.release[target].image}`;
const reference = new RegExp(`^${versions.registry.replaceAll('.', '\\.')}/` +
  `(${Object.values(versions.release).map(release => release.image).join('|')}):([A-Za-z0-9_.-]+)$`, 'u');
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', APP_PRIVATE_KEY: '' } });
  if (result.status !== 0 || result.error) {
    throw new Error(`${command} operation failed; credential-bearing output withheld`);
  }
  return result;
}
function digest(raw) { return `sha256:${createHash('sha256').update(raw).digest('hex')}`; }
async function inspect(image) {
  const match = reference.exec(image);
  if (!match) throw new Error('Unexpected release image reference');
  const [, name, tag] = match;
  const credentials = Buffer.from(`${username}:${token}`).toString('base64');
  const authorization = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(`repository:${name}:pull`)}`, {
    headers: { Authorization: `Basic ${credentials}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!authorization.ok) throw new Error('GHCR authorization failed; raw output withheld');
  const issued = await authorization.json();
  const bearer = issued.token ?? issued.access_token;
  if (typeof bearer !== 'string' || !bearer) throw new Error('GHCR did not issue registry authorization');
  const response = await fetch(`https://ghcr.io/v2/${name}/manifests/${tag}`, {
    headers: { Authorization: `Bearer ${bearer}`,
      Accept: 'application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Registry inspection failed; authentication failures are not absence');
  return digest(Buffer.from(await response.arrayBuffer()));
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
