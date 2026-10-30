import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Web and Tavern recipes are independent and do not leak assets', async () => {
  const web = await read('docker/web.Dockerfile');
  const tavern = await read('docker/tavern.Dockerfile');
  const versions = JSON.parse(await read('versions.json'));

  assert.match(web, /COPY docker\/runtime\/web\/package\.json/u);
  assert.match(web, /--no-frozen-lockfile/u);
  assert.doesNotMatch(web, /dsh-tavern|wrongbook|tavern\/pnpm-lock|seed-tavern/u);
  assert.doesNotMatch(web, /FROM (?:tavern|web)-application AS tavern/u);

  assert.match(tavern, /--frozen-lockfile/u);
  assert.match(tavern, /patches\/wrongbook\/patch-all\.mjs/u);
  assert.doesNotMatch(tavern, /dsh-context|dsh-mnemon|dsh-ssh|dshmarket|docker\/skills|rtk-oss/u);
  assert.doesNotMatch(tavern, /FROM web-application/u);

  assert.match(web, new RegExp(`version="${versions.distribution}"`, 'u'));
  assert.match(tavern, new RegExp(`version="${versions.tavern.version}"`, 'u'));
});

test('Web profile bundles memory and integration plugins without a committed lock', async () => {
  const recipe = await read('scripts/materialize-profiles.mjs');
  const webRecipe = recipe.slice(recipe.indexOf("if (profile === 'web')"), recipe.indexOf('} else {', recipe.indexOf("if (profile === 'web')")));
  for (const name of ['dsh-context', 'dsh-mnemon', '@michengai/dsh-automation',
    '@xmanrui/dsh-im', 'dsh-better-sidebar', '@linxin666/dsh-ssh']) {
    assert.ok(webRecipe.includes(`'${name}'`), `Web recipe includes ${name}`);
  }
  const pin = name => webRecipe.match(new RegExp(`dependencies\\['${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\] = '([^']+)'`))?.[1];
  assert.match(await read('scripts/entrypoint.sh'), /\/data\/memory/u);
  assert.match(await read('docker/profiles/web/pnpm-workspace.yaml'), /ssh2: true/u);
  assert.match(await read('docker/profiles/web/cordis.patch.yml'), /storageScope: custom/u);
  assert.match(await read('docker/profiles/web/cordis.patch.yml'), /dataDir: \/data\/memory\/mnemon/u);
  const compatibility = JSON.parse(await read('docker/profiles/web/compatibility.json'));
  assert.deepEqual(compatibility[`@xmanrui/dsh-im@${pin('@xmanrui/dsh-im')}`], ['0.2.2-alpha.2']);
  assert.deepEqual(compatibility[`dsh-context@${pin('dsh-context')}`], ['0.2.2-alpha.2']);
  await assert.rejects(read('docker/profiles/web/pnpm-lock.yaml'));
});

test('deployment examples carry the memory root and MCP mount shape', async () => {
  assert.match(await read('deploy/docker/compose.yaml'), /\n    volumes:\n      - dsh-web-data:\/data/u);
  assert.match(await read('deploy/kubernetes/dsh-web.yaml'), /- name: data\n\s+mountPath: \/data/u);
  const mcp = await read('deploy/docker/cordis.patch.mcp.example.yml');
  for (const id of ['mcp-search', 'mcp-cluster', 'mcp-home']) assert.match(mcp, new RegExp(`id: ${id}`, 'u'));
  assert.match(mcp, /Authorization: "Bearer </u);
});
