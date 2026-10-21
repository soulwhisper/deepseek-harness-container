// Trusted release only. Copy a locally built, smoked multi-arch OCI index to
// its version tag without rebuilding or replacing an immutable tag.
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const mode = process.argv[2];
const requested = process.argv[3];
const repository = 'soulwhisper/deepseek-harness-container';
const sha = process.env.GITHUB_SHA;
const token = process.env.GITHUB_TOKEN;
const username = process.env.GHCR_USERNAME ?? process.env.GITHUB_ACTOR;
const versions = JSON.parse(await readFile(new URL('../versions.json', import.meta.url), 'utf8'));
const releases = {
  web: { tag: versions.release.web.tag, version: versions.dsh.version },
  tavern: { tag: versions.release.tavern.tag, version: versions.tavern.version },
};
if (process.env.GITHUB_REPOSITORY !== repository || !/^[a-f0-9]{40}$/u.test(sha ?? '')
  || !['check', 'release'].includes(mode) || !Object.hasOwn(releases, requested)
  || (mode === 'release' && (!token || !username))) {
  throw new Error('Release requires the trusted repository, exact commit, target and release token');
}
const imageName = target => `${versions.registry}/${versions.release[target].image}`;
const reference = new RegExp(`^${versions.registry.replaceAll('.', '\\.')}/` +
  `(${Object.values(versions.release).map(release => release.image).join('|')}):([A-Za-z0-9_.-]+)$`, 'u');
const directory = await mkdtemp(join(tmpdir(), 'dsh-release-'));
const authfile = join(directory, 'auth.json');
function run(command, args, input, optional = false) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', APP_PRIVATE_KEY: '' } });
  if ((result.status !== 0 || result.error) && !optional) {
    throw new Error(`${command} operation failed; credential-bearing output withheld`);
  }
  return result;
}
function digest(raw) { return `sha256:${createHash('sha256').update(raw).digest('hex')}`; }
const registryTokens = new Map();
async function inspect(image, missingAllowed = false) {
  const match = reference.exec(image);
  if (!match) throw new Error('Unexpected release image reference');
  const [, name, tag] = match;
  // Ask for push+pull, not pull-only: a new GHCR package must be creatable on
  // first publication. Authentication failures are never treated as absence.
  let bearer = registryTokens.get(name);
  if (!bearer) {
    const credentials = Buffer.from(`${username}:${token}`).toString('base64');
    const response = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(`repository:${name}:pull,push`)}`, {
      headers: { Authorization: `Basic ${credentials}` }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('GHCR authorization failed; raw output withheld');
    const authorization = await response.json();
    bearer = authorization.token ?? authorization.access_token;
    if (typeof bearer !== 'string' || !bearer) throw new Error('GHCR did not issue registry authorization');
    registryTokens.set(name, bearer);
  }
  const response = await fetch(`https://ghcr.io/v2/${name}/manifests/${tag}`, {
    headers: { Authorization: `Bearer ${bearer}`,
      Accept: 'application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404 && missingAllowed) return undefined;
  if (!response.ok) throw new Error('Registry inspection failed; authentication failures are not absence');
  return digest(Buffer.from(await response.arrayBuffer()));
}
async function copy(source, destination, expected, local = false) {
  const previous = await inspect(destination, true);
  if (previous !== undefined) {
    if (previous !== expected) throw new Error('Refusing to overwrite an existing immutable image tag');
    return;
  }
  run('skopeo', ['copy', '--all', '--preserve-digests', '--authfile', authfile,
    ...(local ? ['--src-tls-verify=false'] : []), `docker://${source}`, `docker://${destination}`]);
  if (await inspect(destination) !== expected) throw new Error('Published OCI graph digest changed');
}
try {
  const { tag, version } = releases[requested];
  if (process.env.GITHUB_REF !== `refs/tags/${tag}`) {
    throw new Error(`Release tag ${tag} must match versions.json exactly`);
  }
  run('git', ['merge-base', '--is-ancestor', sha, 'origin/main']);
  if (mode === 'check') {
    console.log(`release route ok: ${tag} -> ${imageName(requested)}:${version}`);
  } else {
    const expected = process.env.IMAGE_DIGEST;
    if (!/^sha256:[a-f0-9]{64}$/.test(expected ?? '')) throw new Error('Missing tested image digest');
    run('skopeo', ['login', '--authfile', authfile, '--username', username,
      '--password-stdin', 'ghcr.io'], token);
    const image = imageName(requested);
    await copy(`localhost:5000/dsh-${requested}@${expected}`, `${image}:${version}`, expected, true);
    const notes = ['Self-packaged DSH distribution; upstream remains a developer preview.', '',
      `Release tag: ${tag}`,
      `Image: ${image}:${version}`,
      'Multi-arch linux/amd64 + linux/arm64 index; amd64 final-image smoke and arm64 native-module probe passed before publication.',
      'OCI graph includes BuildKit provenance and SBOM; these are inventory, not a security audit.', '',
      'Immutable image:', `- ${image}@${expected}`];
    if (requested === 'tavern') {
      notes.push('', 'Tavern source and AGPL-3.0 license are included in the image; see NOTICE and READMEs.');
    }
    notes.push('', `Source: https://github.com/${repository}/tree/${sha}`);
    await writeFile(join(process.env.RUNNER_TEMP ?? tmpdir(), 'dsh-release-notes.txt'), `${notes.join('\n')}\n`, { mode: 0o600 });
    console.log(`${requested}: ${expected}`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
