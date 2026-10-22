import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = new URL('../plugins/mobile-layout/', import.meta.url);
const clientSource = readFileSync(new URL('lib/client.js', root), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const patch = readFileSync(new URL('cordis.patch.yml', root), 'utf8');

let registration;
vm.runInNewContext(clientSource, {
  window: {
    __ModuleLoader__: {
      load(value) {
        registration = value;
      },
    },
  },
});

const api = registration.factory(() => ({}));

test('package mounts one Web client row', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.deepEqual(manifest.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-layout']);
  assert.match(patch, /id: mobile-layout/u);
  assert.match(patch, /name: '@soulwhisper\/dsh-mobile-layout'/u);
  assert.equal(registration.id, '@soulwhisper/dsh-mobile-layout');
  assert.equal(typeof api.apply, 'function');
  assert.deepEqual([...api.inject], ['layout']);
});

test('explicit mode outranks auto and URL outranks storage', () => {
  assert.equal(api.resolveMode({ url: 'mobile', stored: 'desktop', narrow: false }), 'mobile');
  assert.equal(api.resolveMode({ url: 'desktop', stored: 'mobile', narrow: true }), 'desktop');
  assert.equal(api.resolveMode({ url: null, stored: 'desktop', narrow: true }), 'desktop');
});

test('auto resolves from the narrow viewport', () => {
  assert.equal(api.resolveMode({ url: 'auto', stored: 'desktop', narrow: true }), 'mobile');
  assert.equal(api.resolveMode({ url: null, stored: 'auto', narrow: false }), 'desktop');
  assert.equal(api.resolveMode({ url: 'nonsense', stored: 'desktop', narrow: false }), 'desktop');
});

test('the button toggles between the two usable layouts', () => {
  assert.equal(api.nextMode('mobile'), 'desktop');
  assert.equal(api.nextMode('desktop'), 'mobile');
});

test('the mobile viewport requests keyboard layout resizing', () => {
  assert.match(api.viewportContent('mobile'), /viewport-fit=cover/u);
  assert.match(api.viewportContent('mobile'), /interactive-widget=resizes-content/u);
  assert.equal(api.viewportContent('desktop'), null);
});
