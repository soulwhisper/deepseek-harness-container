#!/usr/bin/env node
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import { relativeLinkCount } from './normalize-locks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const text = path => readFile(join(root, path), 'utf8');
const versions = JSON.parse(await text('versions.json'));
const packageJson = JSON.parse(await text('package.json'));
assert.equal(packageJson.version, versions.distribution, 'Distribution and package version must agree');
assert.equal(packageJson.license, 'Apache-2.0');
assert.match(await text('LICENSE'), /Apache License\s+Version 2\.0/u);
assert.equal(versions.schemaVersion, 2);
assert.equal(versions.registry, 'ghcr.io/soulwhisper');
for (const [target, version] of Object.entries({ web: versions.dsh.version, tavern: versions.tavern.version })) {
  const release = versions.release?.[target];
  assert.equal(release?.tag, `${target}-${version}`, `${target} release tag must track its upstream version`);
  assert.equal(release?.image, `dsh-${target}`, `${target} image name`);
}
assert.equal(versions.tavern.upstreamTag, `v${versions.tavern.version}`, 'Tavern upstream tag keeps its v prefix; release/image tags do not');
assert.match(versions.node.image, new RegExp(`^node:${versions.node.version.replaceAll('.', '\\.')}-.+@sha256:[a-f0-9]{64}$`));
assert.match(await text('docker/Dockerfile'), new RegExp(`org\\.opencontainers\\.image\\.version="${versions.dsh.version}"`, 'u'));
assert.match(await text('docker/Dockerfile'), new RegExp(`org\\.opencontainers\\.image\\.version="${versions.tavern.version}"`, 'u'));
assert.match(versions.dsh.commit, /^[a-f0-9]{40}$/u);
assert.match(versions.tavern.commit, /^[a-f0-9]{40}$/u);
assert.match(versions.tavern.routesSha256, /^[a-f0-9]{64}$/u);
assert.match(versions.pnpm, /^\d+\.\d+\.\d+$/u);
assert.equal(packageJson.packageManager, `pnpm@${versions.pnpm}`);
const rootLock = parse(await text('pnpm-lock.yaml'));
assert.ok(rootLock.importers?.['.'], 'Committed root dependency closure');
const runtime = JSON.parse(await text('docker/runtime/package.json'));
assert.equal(runtime.dependencies['@deepseek-ai/dsh'], versions.dsh.version);
assert.equal(runtime.dependencies.dshmarket, versions.market);
const runtimeLock = parse(await text('docker/runtime/pnpm-lock.yaml'));
assert.ok(runtimeLock.importers?.['.'], 'Committed runtime dependency closure');
for (const [name, spec] of Object.entries(versions.ecosystem)) {
  assert.match(name, /^[a-z][a-z0-9-]*$/u);
  assert.match(spec, /^github:[^/]+\/[^#]+#[^#]+$/u);
}
for (const profile of ['web', 'tavern']) {
  const lockText = await text(`docker/profiles/${profile}/pnpm-lock.yaml`);
  const lock = parse(lockText);
  assert.ok(lock.importers?.['.'], `Committed ${profile} lock required; use explicit bootstrap workflow, review and commit its artifact`);
  assert.equal(relativeLinkCount(lockText), 0, `${profile} lock link versions must be absolute; run scripts/normalize-locks.mjs`);
}
// Keep local patches, the SSO plugin, image build, scaffold and examples in
// separate trees so an upstream break stays local to its patch surface.
async function present(path) { try { await access(join(root, path)); return true; } catch { return false; } }
for (const path of ['docker/Dockerfile', 'docker/runtime/package.json', 'docker/profiles/web/pnpm-lock.yaml',
  'patches/dsh/patch-host.mjs', 'patches/market/patch-market.mjs', 'patches/tavern/patch-tavern.mjs',
  'plugins/sso/index.mjs', 'scripts/normalize-locks.mjs', 'test/packaging.test.mjs',
  'deploy/docker/compose.yaml', 'deploy/kubernetes/dsh-web.yaml',
  '.github/CODEOWNERS', '.github/PULL_REQUEST_TEMPLATE.md', '.github/labels.yaml',
  '.github/labeler.yaml', '.github/workflows/label-sync.yaml',
  '.github/workflows/schedule-cleanup.yaml', '.coderabbit.yaml', 'renovate.json']) {
  assert.ok(await present(path), `Repository layout requires ${path}`);
}
for (const legacy of ['Dockerfile', 'profiles', 'runtime']) {
  assert.equal(await present(legacy), false, `Repository layout: move ${legacy} out of the root category tree`);
}
for (const obsolete of ['.github/actions/validate/action.yaml', '.github/workflows/labeler.yaml']) {
  assert.equal(await present(obsolete), false, `${obsolete} was folded into ci.yaml`);
}
for (const directory of ['plugins/sso', 'scripts']) {
  for (const name of await readdir(join(root, directory))) {
    assert.doesNotMatch(name, /^patch-.*\.mjs$/u, `Patches belong under patches/, not ${directory}/${name}`);
  }
}
// Automation contract: changes arrive by PR, feature branches never publish,
// Renovate never merges on its own, and DSH/Tavern upstream bumps are tracked.
const ciWorkflow = parse(await text('.github/workflows/ci.yaml'));
assert.ok(ciWorkflow.on.pull_request !== undefined && ciWorkflow.on.merge_group !== undefined, 'CI must run on pull requests and merge groups');
assert.ok(ciWorkflow.jobs?.label, 'Labeler is part of the CI workflow');
assert.match(await text('.github/workflows/ci.yaml'), /create-github-app-token/u, 'CI labeler uses the GitHub App token');
const publishWorkflow = parse(await text('.github/workflows/publish.yaml'));
assert.deepEqual(publishWorkflow.on.push.tags, ['web-*', 'tavern-*'], 'Release triggers only on image tags');
assert.equal(publishWorkflow.on.push.branches, undefined, 'Branch pushes must not publish');
const publishText = await text('.github/workflows/publish.yaml');
assert.match(publishText, /create-github-app-token/u, 'Release uses the GitHub App token');
assert.doesNotMatch(publishText, /GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/u, 'Release must not write with the default bot token');
const lockWorkflow = parse(await text('.github/workflows/profile-locks.yaml'));
assert.deepEqual(Object.keys(lockWorkflow.on), ['workflow_dispatch'], 'Profile-lock bootstrap is manual only');
const cleanupWorkflow = parse(await text('.github/workflows/schedule-cleanup.yaml'));
assert.ok(cleanupWorkflow.on.schedule, 'Workflow cleanup must be scheduled');
assert.match(await text('.github/workflows/schedule-cleanup.yaml'), /create-github-app-token/u, 'Cleanup uses the GitHub App token');
assert.match(await text('.github/workflows/label-sync.yaml'), /create-github-app-token/u, 'Label sync uses the GitHub App token');
const renovate = JSON.parse(await text('renovate.json'));
assert.ok(renovate.extends.includes('github>soulwhisper/renovate-config'), 'Renovate extends the shared preset');
assert.equal(renovate.packageRules.some(rule => rule.automerge === true), false, 'Renovate must never automerge');
assert.ok(renovate.packageRules.some(rule => rule.addLabels?.includes('review/required')), 'Renovate PRs require human review');
for (const dep of ['@deepseek-ai/dsh', 'flizzywine/dsh-tavern']) {
  assert.ok(renovate.customManagers.some(manager => manager.depNameTemplate === dep), `Renovate must track ${dep}`);
}
const coderabbit = parse(await text('.coderabbit.yaml'));
assert.equal(coderabbit.reviews?.tools?.actionlint?.enabled, true, 'CodeRabbit actionlint enabled');
assert.ok(coderabbit.reviews?.path_instructions?.length > 0, 'CodeRabbit has repository-specific review instructions');
const labels = parse(await text('.github/labels.yaml'));
assert.ok(labels.some(label => label.name === 'review/required'), 'review/required label exists');
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
for (const path of await files(root)) {
  const name = relative(root, path);
  if (name.endsWith('.mjs')) {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, `JavaScript syntax: ${name}`);
  }
  if (name.startsWith('.github/') && /\.ya?ml$/u.test(name)) {
    const contents = await readFile(path, 'utf8');
    parse(contents, { uniqueKeys: true });
    assert.doesNotMatch(contents, /pull_request_target|workflow_run|--auto(?:\s|$)/u, 'No elevated untrusted or auto-merge workflow');
    for (const match of contents.matchAll(/\buses:\s*([^\s#]+)/gu)) {
      if (!match[1].startsWith('./')) assert.match(match[1], /@[a-f0-9]{40}$/u, `Pinned Action: ${name}`);
    }
  }
}
const ciText = await text('.github/workflows/ci.yaml');
const ciConfig = parse(ciText);
for (const job of ['build', 'ci-pass']) {
  assert.doesNotMatch(JSON.stringify(ciConfig.jobs?.[job]), /secrets\./u, `${job} must not receive repository secrets`);
}
assert.match(JSON.stringify(ciConfig.jobs?.label), /secrets\.APP_CLIENT_ID/u, 'Labeler uses the GitHub App credential only');
console.log('PASS source pins, licenses, committed locks, JavaScript syntax, workflow policy');
