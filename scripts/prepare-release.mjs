#!/usr/bin/env node
// Prepare a Web distribution release PR. This script only edits a checkout:
// it never tags, merges, publishes or creates a GitHub Release.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const cliPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
const sections = [
  ['feat', 'Features'],
  ['fix', 'Bug Fixes'],
  ['perf', 'Performance Improvements'],
  ['deps', 'Dependencies'],
  ['docs', 'Documentation'],
  ['build', 'Build System'],
  ['ci', 'Continuous Integration'],
  ['refactor', 'Code Refactoring'],
  ['test', 'Tests'],
  ['chore', 'Chores'],
  ['revert', 'Reverts'],
];
const sectionByType = new Map(sections);
const sectionOrder = [...sections.map(([, name]) => name), 'Other Changes'];
const knownWebDocs = ['README.md', 'README.zh-CN.md', 'docs/architecture.md', 'docs/index.md'];

function git(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args[0]} failed`);
  }
  return result.stdout.trim();
}

async function json(path) {
  return JSON.parse(await readFile(join(root, path), 'utf8'));
}

async function saveJson(path, value) {
  await writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

export function validateVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error('version must be a SemVer-like release version, for example 0.2.1-rc.3');
  }
  return version;
}

export function parseCommitLine(line) {
  const [hash = '', ...rest] = line.split('\t');
  const subject = rest.join('\t').trim();
  const match = /^([a-z]+)(?:\(([^)]+)\))?!?:\s+(.+)$/iu.exec(subject);
  return {
    hash,
    type: match?.[1]?.toLowerCase() ?? 'other',
    scope: match?.[2] ?? '',
    summary: match?.[3] ?? subject,
  };
}

export function renderChangelog({ version, date, webTag, tavernTag, baseTag, commits, previous = '' }) {
  validateVersion(version);
  if (previous.includes(`## [${version}]`)) {
    throw new Error(`CHANGELOG already contains ${version}`);
  }
  const groups = new Map(sectionOrder.map(name => [name, []]));
  for (const commit of commits) {
    const section = sectionByType.get(commit.type) ?? 'Other Changes';
    groups.get(section).push(`- ${commit.summary} (${commit.hash})`);
  }
  const lines = [
    `## [${version}] - ${date}`,
    '',
    `Web tag: \`${webTag}\`; Tavern tag: \`${tavernTag}\` (unchanged by this preparation).`,
    '',
    `Changes since \`${baseTag}\`:`,
    '',
  ];
  for (const section of sectionOrder) {
    const entries = groups.get(section);
    if (entries.length === 0) continue;
    lines.push(`### ${section}`, '', ...entries, '');
  }
  const body = lines.join('\n').trimEnd();
  if (!previous.trim()) return `# Changelog\n\n${body}\n`;
  const marker = '# Changelog';
  const index = previous.indexOf(marker);
  if (index === -1) return `# Changelog\n\n${body}\n\n${previous.trimEnd()}\n`;
  const before = previous.slice(0, index + marker.length);
  const after = previous.slice(index + marker.length).replace(/^\s*/u, '');
  return `${before}\n\n${body}\n\n${after}`.trimEnd() + '\n';
}

async function main() {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      'base-tag': { type: 'string' },
    },
    allowPositionals: false,
    args: process.argv.slice(2),
  });
  const version = validateVersion(values.version ?? process.env.VERSION);
  const explicitBase = values['base-tag'] ?? process.env.BASE_TAG ?? '';
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main' && process.env.GITHUB_ACTIONS === 'true') {
    throw new Error('prepare-release must run from main');
  }
  if (git(['status', '--porcelain']) !== '') {
    throw new Error('prepare-release requires a clean worktree');
  }
  const versions = await json('versions.json');
  const packageJson = await json('package.json');
  const runtime = await json('docker/runtime/package.json');
  const oldDistribution = versions.distribution;
  if (oldDistribution === version) throw new Error('version is already the current distribution');
  const webTag = `web-${version}`;
  if (git(['tag', '--list', webTag]) !== '') throw new Error(`release tag ${webTag} already exists`);
  const baseTag = explicitBase || git([
    'tag', '--merged', 'HEAD', '--sort=-creatordate', '--list', 'web-*', 'tavern-*',
  ]).split('\n').find(Boolean) || git(['rev-list', '--max-parents=0', 'HEAD']).split('\n').pop();
  git(['rev-parse', '--verify', `${baseTag}^{commit}`]);
  git(['merge-base', '--is-ancestor', baseTag, 'HEAD']);
  const commits = git([
    'log', '--no-merges', '--pretty=format:%h%x09%s', `${baseTag}..HEAD`,
  ]).split('\n').filter(Boolean).map(parseCommitLine);
  if (commits.length === 0) throw new Error(`no commits since ${baseTag}`);
  const date = git(['show', '-s', '--format=%cs', 'HEAD']) || new Date().toISOString().slice(0, 10);
  const previous = await readFile(join(root, 'CHANGELOG.md'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const changelog = renderChangelog({
    version, date, webTag, tavernTag: versions.release.tavern.tag, baseTag, commits, previous,
  });

  versions.distribution = version;
  versions.release.web.tag = webTag;
  packageJson.version = version;
  runtime.version = version;
  await saveJson('versions.json', versions);
  await saveJson('package.json', packageJson);
  await saveJson('docker/runtime/package.json', runtime);

  const dockerPath = join(root, 'docker/Dockerfile');
  const dockerfile = await readFile(dockerPath, 'utf8');
  const oldLabel = `org.opencontainers.image.version="${oldDistribution}"`;
  if (dockerfile.split(oldLabel).length !== 2) {
    throw new Error('Dockerfile must contain exactly one Web distribution version label');
  }
  await writeFile(dockerPath, dockerfile.replace(oldLabel, `org.opencontainers.image.version="${version}"`));

  for (const path of knownWebDocs) {
    const file = join(root, path);
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replaceAll(oldDistribution, version));
  }
  await writeFile(join(root, 'CHANGELOG.md'), changelog);

  console.log(`prepared ${version}`);
  console.log(`web_tag=${webTag}`);
  console.log(`base_tag=${baseTag}`);
  console.log(`commits=${commits.length}`);
  console.log(`changelog=${join(root, 'CHANGELOG.md')}`);
}

if (cliPath && import.meta.url === cliPath) await main();
