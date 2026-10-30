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
for (const [target, version] of Object.entries({ web: versions.distribution, tavern: versions.tavern.version })) {
  const release = versions.release?.[target];
  assert.equal(release?.tag, `${target}-${version}`, `${target} release tag must track its release version`);
  assert.equal(release?.image, `dsh-${target}`, `${target} image name`);
}
assert.equal(versions.tavern.upstreamTag, `v${versions.tavern.version}`, 'Tavern upstream tag keeps its v prefix; release/image tags do not');
assert.equal(versions.release.tavern.tag, `tavern-${versions.tavern.version}`, 'Tavern release tag matches the image version');
assert.match(versions.node.image, new RegExp(`^node:${versions.node.version.replaceAll('.', '\\.')}-.+@sha256:[a-f0-9]{64}$`));
const webDockerfile = await text('docker/web.Dockerfile');
const tavernDockerfile = await text('docker/tavern.Dockerfile');
assert.match(webDockerfile, new RegExp(`org\\.opencontainers\\.image\\.version="${versions.distribution}"`, 'u'));
assert.match(tavernDockerfile, new RegExp(`org\\.opencontainers\\.image\\.version="${versions.tavern.version}"`, 'u'));
assert.match(versions.dsh.commit, /^[a-f0-9]{40}$/u);
assert.equal(versions.webDsh?.version, '0.2.2-alpha.2');
assert.equal(versions.tavern.theme?.version, versions.dsh.version);
assert.match(versions.tavern.commit, /^[a-f0-9]{40}$/u);
assert.match(versions.tavern.routesSha256, /^[a-f0-9]{64}$/u);
assert.equal(versions.tavern.theme?.package, '@deepseek-ai/dsh-client-ui-theme');
assert.equal(versions.tavern.theme?.version, versions.dsh.version);
assert.match(versions.tavern.theme?.indexSha256, /^[a-f0-9]{64}$/u);
assert.match(versions.tavern.theme?.clientSha256, /^[a-f0-9]{64}$/u);
assert.match(versions.pnpm, /^\d+\.\d+\.\d+$/u);
assert.equal(packageJson.packageManager, `pnpm@${versions.pnpm}`);
const rootLock = parse(await text('pnpm-lock.yaml'));
assert.ok(rootLock.importers?.['.'], 'Committed root dependency closure');
const webRuntime = JSON.parse(await text('docker/runtime/web/package.json'));
assert.equal(webRuntime.dependencies['@deepseek-ai/dsh'], versions.webDsh.version);
assert.equal(webRuntime.dependencies.dshmarket, versions.market);
assert.equal(await present('docker/runtime/web/pnpm-lock.yaml'), false,
  'The Web runtime is resolved at image-build time; the published digest is the boundary');
assert.ok(await present('docker/runtime/tavern/pnpm-lock.yaml'), 'The Tavern runtime lock remains committed');
const tavernRuntime = JSON.parse(await text('docker/runtime/tavern/package.json'));
assert.equal(tavernRuntime.dependencies['@deepseek-ai/dsh'], versions.dsh.version);
const runtimeLock = parse(await text('docker/runtime/tavern/pnpm-lock.yaml'));
assert.ok(runtimeLock.importers?.['.'], 'Committed Tavern runtime dependency closure');
for (const [name, spec] of Object.entries(versions.ecosystem)) {
  assert.match(name, /^[a-z][a-z0-9-]*$/u);
  assert.match(spec, /^github:[^/]+\/[^#]+#[^#]+$/u);
}
assert.equal(Object.hasOwn(versions.ecosystem, 'dsh-tavern-comfy'), false,
  'Tavern image plugin is bundled with Tavern, not a profile dependency');
assert.match(tavernDockerfile, /scripts\/seed-tavern-plugins\.mjs/u,
  'Tavern bundled plugin seed script is shipped in the image');
assert.equal(await present('docker/profiles/web/pnpm-lock.yaml'), false,
  'The Web profile is mutable and has no committed lock');
const tavernLockText = await text('docker/profiles/tavern/pnpm-lock.yaml');
const tavernLock = parse(tavernLockText);
assert.ok(tavernLock.importers?.['.'], 'Committed Tavern profile lock required; use explicit bootstrap workflow, review and commit its artifact');
assert.equal(relativeLinkCount(tavernLockText), 0, 'Tavern lock link versions must be absolute; run scripts/normalize-locks.mjs');
assert.doesNotMatch(tavernLockText, /node-addon-system-(?:linux|darwin|win32)-/u,
  'Tavern lock must not contain architecture-specific overrides');
// Keep local patches, the forward-auth plugin, image build, scaffold and
// examples in separate trees so an upstream break stays local to its surface.
async function present(path) { try { await access(join(root, path)); return true; } catch { return false; } }
const forwardAuthManifest = JSON.parse(await text('plugins/forward-auth/package.json'));
assert.equal(forwardAuthManifest.license, 'Apache-2.0', 'forward-auth is an original Apache-2.0 package');
assert.ok(!forwardAuthManifest.files.includes('upstream-MIT-LICENSE'), 'forward-auth must not package upstream DSH licensing as its own');
assert.equal(await present('plugins/forward-auth/upstream-MIT-LICENSE'), false, 'Upstream DSH MIT notice belongs under patches/dsh');
assert.ok(await present('patches/dsh/upstream-MIT-LICENSE'), 'Patched upstream DSH notice must remain in the distribution');
for (const path of ['docker/web.Dockerfile', 'docker/tavern.Dockerfile',
  'docker/runtime/web/package.json', 'docker/runtime/tavern/package.json',
  'docker/profiles/web/cordis.patch.yml', 'docker/profiles/web/compatibility.json',
  'docker/skills/README', 'docker/skills/rtk/SKILL.md',
  'patches/dsh/patch-host.mjs', 'patches/market/patch-market.mjs', 'patches/tavern/patch-tavern.mjs',
  'patches/wrongbook/patch-all.mjs', 'patches/wrongbook/patch-mvu-api.mjs',
  'patches/wrongbook/patch-timeout-body.mjs',
  'plugins/forward-auth/index.mjs', 'scripts/normalize-locks.mjs', 'scripts/floating-bundles.mjs',
  'scripts/seed-tavern-plugins.mjs', 'scripts/seed-tavern-tools.mjs',
  'scripts/field-test.mjs', 'test/packaging.test.mjs',
  'deploy/docker/compose.yaml', 'deploy/docker/cordis.patch.mcp.example.yml', 'deploy/kubernetes/dsh-web.yaml',
  'docs/index.md', 'docs/architecture.md', 'docs/constraints.md', 'docs/build.md', 'docs/deploy.md',
  'docs/operations.md', 'docs/data-layout.md', 'docs/browser.md', 'docs/patches.md', 'docs/source-build.md',
  'docs/regulations.md', 'docs/forward-auth.md', 'mkdocs.yml',
  '.github/workflows/docs.yaml',
  '.github/CODEOWNERS', '.github/PULL_REQUEST_TEMPLATE.md', '.github/labels.yaml',
  '.github/labeler.yaml', '.github/workflows/labeler.yaml', '.github/workflows/label-sync.yaml',
  '.renovate/customManagers.json', '.renovate/groups.json', '.renovate/packageRules.json',
  '.github/workflows/schedule-cleanup.yaml', '.github/workflows/field-test.yaml', '.coderabbit.yaml', 'renovate.json']) {
  assert.ok(await present(path), `Repository layout requires ${path}`);
}
for (const legacy of ['Dockerfile', 'profiles', 'runtime', 'docker/Dockerfile', 'docker/runtime/package.json', 'docker/profiles/web/pnpm-lock.yaml', 'docker/README.md', 'deploy/README.md',
  'patches/README.md', 'docker/profiles/tavern/SOURCE-BUILD.txt']) {
  assert.equal(await present(legacy), false, `Repository layout: move ${legacy} out of the category tree`);
}
assert.equal(await present('.github/actions/validate/action.yaml'), false, 'The custom composite validator is gone');
const dockerfile = `${webDockerfile}\n${tavernDockerfile}`;
assert.doesNotMatch(dockerfile, /COPY \. /u, 'Final images must not copy the whole repository context');
assert.match(dockerfile, /FROM scratch AS distribution-source/u, 'Explicit source payload stage');
assert.match(dockerfile, /COPY --from=distribution-source/u, 'Final image uses the source payload stage');
assert.match(dockerfile, /XDG_CACHE_HOME=\/cache/u, 'Cache is outside /data');
assert.match(dockerfile, /DSH_BACKUP_ROOT=\/backups/u, 'Rollback root is outside /data');
assert.match(dockerfile, /COPY docker\/skills\/ \/opt\/dsh\/seed\/skills\//u, 'Bundled skill recommendations are seeded from the image');
assert.doesNotMatch(dockerfile, /DSH_BUNDLED_SKILL_DIR/u, 'Bundled skills are not an immutable runtime scan root');
assert.doesNotMatch(dockerfile, /COPY docker\/skills\/ \/opt\/dsh\/skills\//u, 'Skills must not be mounted as immutable runtime content');
assert.doesNotMatch(dockerfile, /scripts\/smoke\.mjs|test\/|deploy\/|\.github\//u,
  'Test, smoke, deploy and CI inputs must not be copied into images');
assert.doesNotMatch(dockerfile, /pnpm --dir \/opt\/dsh\/runtime add dsh-context/u,
  'dsh-context must not be installed into the immutable runtime');
assert.doesNotMatch(dockerfile, /patch-host\.mjs --repair/u, 'Runtime plugin installs must not require patch repair');
assert.match(dockerfile, /patches\/wrongbook\/patch-all\.mjs/u,
  'Tavern build invokes the vendored wrongbook host patches');
assert.match(dockerfile, /--apply --strict --no-backup/u,
  'Wrongbook patches are applied strictly at build time, without source backups');
assert.match(dockerfile, /scripts\/seed-tavern-tools\.mjs/u,
  'Tavern seeds the wrongbook patch tool into user data');
assert.match(await text('scripts/entrypoint.sh'), /seed-tavern-tools\.mjs/u,
  'Tavern startup seeds the wrongbook patch tool');
for (const path of ['patches/wrongbook/patch-all.mjs', 'patches/wrongbook/patch-mvu-api.mjs',
  'patches/wrongbook/patch-timeout-body.mjs', 'scripts/seed-tavern-tools.mjs']) {
  assert.doesNotMatch(await text(path), /C:\/Users|C:\\Users/u,
    `Distribution-owned paths must not retain upstream workstation paths: ${path}`);
}
assert.match(await text('.agents/skills/dsh-maintainer/SKILL.md'), /patches\/wrongbook\/patch-all\.mjs/u,
  'Maintainer skill records the wrongbook patch upgrade check');
assert.match(await text('scripts/materialize-profiles.mjs'), /dependencies\['dsh-context'\] = '0\.78\.1'/u,
  'Web bundles a known dsh-context release');
assert.match(webDockerfile, /pnpm --dir \/opt\/dsh\/seed\/profiles\/web install --no-frozen-lockfile/u,
  'The Web profile is resolved at build time; its digest is the reproducibility boundary');
assert.match(dockerfile, /JuliusBrussee\/caveman\/releases\/latest/u, 'Caveman skill resolves the latest release tag');
assert.match(dockerfile, /skills\/caveman\/SKILL\.md/u, 'Caveman skill is fetched from the resolved release');
assert.doesNotMatch(dockerfile, /caveman\/main\//u, 'Caveman skill must not follow the moving main branch');
assert.match(dockerfile, /rtk-oss-/u, 'Only the Apache-2.0 RTK OSS asset may be bundled');
assert.equal((dockerfile.match(/COPY docker\/skills\/ \/opt\/dsh\/seed\/skills\//gu) ?? []).length, 1,
  'Only one final stage may receive the optional skill seed');
assert.doesNotMatch(dockerfile, /FROM application AS/u,
  'Web and Tavern must not share one final application base');
assert.match(dockerfile, /FROM tools AS web-application/u, 'Web has its own final base');
assert.match(dockerfile, /FROM tools AS tavern-application/u, 'Tavern has its own final base');
const webStage = webDockerfile.slice(webDockerfile.indexOf('FROM web-application AS web'));
const tavernStage = tavernDockerfile.slice(tavernDockerfile.indexOf('FROM tavern-application AS tavern'));
assert.match(webStage, /usr\/local\/bin\/rtk/u, 'Web image receives the RTK binary');
assert.match(webStage, /distribution-source\/docker\/skills/u, 'Web source payload retains its skill sources');
assert.match(await text('.dockerignore'), /^\.agents$/mu, 'Maintainer-only .agents skill is excluded from build context');
assert.doesNotMatch(tavernStage, /rtk|caveman|dsh-context|docker\/skills/iu, 'Tavern must not receive optional Web assets or their source payload');
assert.doesNotMatch(JSON.stringify(versions), /dsh-context|caveman|rtk/iu,
  'Floating assets are not version-pinned in versions.json');
assert.doesNotMatch(webDockerfile, /floating-bundles\.mjs add web/u,
  'Web plugins are bundled from the manifest, not a floating build-time add');
assert.match(webDockerfile, /dsh-mnemon|seed\/skills\/caveman/u,
  'Web image carries the bundled plugin and skill profile');
assert.match(await text('patches/dsh/patch-host.mjs'), /dshTavern\?\.managedBundles/u,
  'Manager protects the pinned Tavern bundle set');
assert.match(await text('scripts/materialize-state.mjs'), /managedDependencies/u,
  'State materialization restores pinned Tavern dependencies');
assert.match(await text('scripts/materialize-state.mjs'),
  /allowBuilds: \{ \.\.\.seedWorkspace\.allowBuilds, \.\.\.previousWorkspace\?\.allowBuilds \}/u,
  'User-approved plugin build scripts must override seed defaults');
assert.doesNotMatch(await text('docker/profiles/web/pnpm-workspace.yaml'), /node-pty:\s*false/u,
  'The Web seed must not deny a package the owner may later approve');
assert.match(await text('scripts/materialize-state.mjs'), /managedLinks\(target/u,
  'Tavern restart restores managed seed links');
const ignore = await text('.gitignore');
assert.match(ignore, /^handoff-\*\.md$/mu, 'Handoff files are ignored');
assert.match(await text('.github/workflows/label-sync.yaml'), /sparse-checkout-cone-mode:\s*false/u,
  'Label sync can check out a single sparse file');
const preCommit = parse(await text('.pre-commit-config.yaml'));
const checkYaml = preCommit.repos.flatMap(repo => repo.hooks ?? []).find(hook => hook.id === 'check-yaml');
assert.deepEqual(checkYaml?.args, ['--allow-multiple-documents'], 'Deploy YAML may contain multiple documents');
for (const directory of ['plugins/forward-auth', 'scripts']) {
  for (const name of await readdir(join(root, directory))) {
    assert.doesNotMatch(name, /^patch-.*\.mjs$/u, `Patches belong under patches/, not ${directory}/${name}`);
  }
}
// Automation contract: changes arrive by PR, feature branches never publish,
// Renovate never merges on its own, and DSH/Tavern upstream bumps are tracked.
const ciText = await text('.github/workflows/ci.yaml');
const ciWorkflow = parse(ciText);
assert.ok(ciWorkflow.on.pull_request !== undefined && ciWorkflow.on.merge_group !== undefined, 'CI must run on pull requests and merge groups');
assert.deepEqual(ciWorkflow.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'ready_for_review'], 'CI has explicit PR activity types');
assert.equal(ciWorkflow.on.push, undefined, 'CI must not duplicate on branch pushes');
assert.equal(ciWorkflow.jobs?.label, undefined, 'Labeler is a separate workflow');
assert.ok(ciWorkflow.jobs?.changes, 'CI keeps a change detector for image-input gating');
assert.equal(ciWorkflow.on.pull_request.paths, undefined, 'Required CI status must exist for docs/test/dot-only PRs');
assert.equal(ciWorkflow.on.pull_request['paths-ignore'], undefined, 'Do not path-filter the required CI workflow');
assert.deepEqual(ciWorkflow.jobs.images.needs, ['changes', 'static'], 'Image matrix depends on the image-input gate');
assert.match(ciText, /needs\.changes\.outputs\.images == 'true'/u, 'Image matrix runs only for image/build inputs');
assert.match(ciText, /\.dockerignore\$/u, 'Docker build-context changes remain image-relevant');
assert.ok(ciText.includes(String.raw`github/workflows/ci\.yaml$`),
  'Image-build workflow changes remain image-relevant');
assert.deepEqual(ciWorkflow.jobs['ci-pass'].needs, ['changes', 'static', 'images'], 'Required gate includes the change detector');
assert.doesNotMatch(ciText, /secrets\./u, 'CI build/test jobs must not receive repository secrets');
const labelerText = await text('.github/workflows/labeler.yaml');
const labelerWorkflow = parse(labelerText);
assert.deepEqual(labelerWorkflow.on.pull_request.types, ['opened', 'synchronize', 'reopened'], 'Labeler has explicit PR activity types');
assert.doesNotMatch(labelerText, /create-github-app-token|secrets\./u, 'PR labeler must not receive App secrets');
assert.match(labelerText, /repo-token:\s*\$\{\{\s*github\.token\s*\}\}/u, 'Labeler uses the job-scoped default token');
const publishWorkflow = parse(await text('.github/workflows/publish.yaml'));
assert.deepEqual(publishWorkflow.on.push.tags, ['web-*', 'tavern-*'], 'Release triggers only on image tags');
assert.equal(publishWorkflow.on.push.branches, undefined, 'Branch pushes must not publish');
assert.equal(publishWorkflow.on.pull_request, undefined, 'Release must not duplicate PR validation');
const publishText = await text('.github/workflows/publish.yaml');
assert.match(publishText, /create-github-app-token/u, 'Release uses the GitHub App token');
assert.match(publishText, /release-digests\/staging-amd64\.digest/u, 'Combine reads the recorded amd64 digest');
assert.match(publishText, /"\$\{IMAGE\}@\$\{amd64_digest\}"/u, 'Combine promotes the amd64 digest-qualified manifest');
assert.match(publishText, /"\$\{IMAGE\}@\$\{arm64_digest\}"/u, 'Combine promotes the arm64 digest-qualified manifest');
assert.doesNotMatch(publishText, /imagetools create[\s\S]{0,400}:tmp-\$\{GITHUB_SHA\}-amd64/u,
  'Combine must not promote mutable staging tags');
assert.match(publishText, /permissions:\s*\n\s*contents:\s*read\s*\n\s*packages:\s*write/u,
  'Release build/combine jobs can publish packages with the job-scoped token');
assert.match(publishText, /TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/u,
  'Registry operations use the repository-scoped token');
assert.match(publishText, /GH_TOKEN:\s*\$\{\{\s*steps\.app\.outputs\.token\s*\}\}/u,
  'Release notes use the GitHub App token');
const lockWorkflow = parse(await text('.github/workflows/profile-locks.yaml'));
assert.deepEqual(Object.keys(lockWorkflow.on), ['workflow_dispatch'], 'Profile-lock bootstrap is manual only');
const cleanupWorkflow = parse(await text('.github/workflows/schedule-cleanup.yaml'));
assert.ok(cleanupWorkflow.on.schedule, 'Workflow cleanup must be scheduled');
assert.ok(cleanupWorkflow.concurrency, 'Workflow cleanup runs are serialized');
assert.match(await text('.github/workflows/schedule-cleanup.yaml'), /create-github-app-token/u, 'Cleanup uses the GitHub App token');
const labelSyncText = await text('.github/workflows/label-sync.yaml');
assert.doesNotMatch(labelSyncText, /create-github-app-token|secrets\./u, 'Label sync must not receive App secrets');
assert.match(labelSyncText, /token:\s*\$\{\{\s*github\.token\s*\}\}/u, 'Label sync uses the job-scoped default token');
assert.doesNotMatch(await text('.github/workflows/ci.yaml'), /GITHUB_TOKEN:\s*\$\{\{\s*(?:github\.token|secrets\.GITHUB_TOKEN)/u,
  'CI must not write with the default bot token');
for (const workflow of ['ci.yaml', 'publish.yaml']) {
  assert.doesNotMatch(await text(`.github/workflows/${workflow}`), /setup-qemu/u,
    `${workflow} uses native architecture runners, not QEMU`);
}
assert.doesNotMatch(await text('.github/workflows/field-test.yaml'), /docker (?:run|build|pull|login)|setup-qemu/iu, 'Field test runs directly on the runner');
const renovate = JSON.parse(await text('renovate.json'));
assert.ok(renovate.extends.includes('github>soulwhisper/renovate-config'), 'Renovate extends the shared runner preset');
const fragmentPaths = ['.renovate/customManagers.json', '.renovate/groups.json', '.renovate/packageRules.json'];
for (const path of fragmentPaths) {
  assert.ok(await present(path), `Renovate override fragment ${path}`);
  assert.ok(renovate.extends.some(item => item.endsWith(path)), `Renovate root extends ${path}`);
}
const customManagers = JSON.parse(await text(fragmentPaths[0])).customManagers;
const groupRules = JSON.parse(await text(fragmentPaths[1])).packageRules;
const packageRules = JSON.parse(await text(fragmentPaths[2])).packageRules;
assert.equal([...groupRules, ...packageRules].some(rule => rule.automerge === true), false, 'Renovate must never automerge');
assert.ok(packageRules.some(rule => rule.addLabels?.includes('review/required')), 'Renovate PRs require human review');
for (const dep of ['@deepseek-ai/dsh', 'flizzywine/dsh-tavern']) {
  assert.ok(customManagers.some(manager => manager.depNameTemplate === dep), `Renovate must track ${dep}`);
}
for (const group of ['dsh-web-upstream', 'dsh-tavern-upstream', 'dsh-market']) {
  assert.ok(groupRules.some(rule => rule.groupName === group), `Renovate group ${group}`);
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
console.log('PASS source pins, licenses, committed locks, JavaScript syntax, workflow policy');
