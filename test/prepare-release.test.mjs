import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCommitLine, renderChangelog, validateVersion,
} from '../scripts/prepare-release.mjs';

test('prepare-release groups conventional history and prepends to the changelog', () => {
  const commits = [
    parseCommitLine('aaa111\tfeat(skill): add native roots'),
    parseCommitLine('bbb222\tfix: repair release path'),
    parseCommitLine('ccc333\tdocs: clarify deployment'),
    parseCommitLine('ddd444\tunmapped subject'),
  ];
  const text = renderChangelog({
    version: '0.2.1-rc.3',
    date: '2026-10-22',
    webTag: 'web-0.2.1-rc.3',
    tavernTag: 'tavern-3.1',
    baseTag: 'web-0.2.1-rc.2-r2',
    commits,
    previous: '# Changelog\n\n## [0.2.1-rc.2-r2] - 2026-10-01\n\n- previous release\n',
  });
  assert.match(text, /^# Changelog\n\n## \[0\.2\.1-rc\.3\] - 2026-10-22/mu);
  assert.match(text, /### Features\n\n- add native roots \(aaa111\)/u);
  assert.match(text, /### Bug Fixes\n\n- repair release path \(bbb222\)/u);
  assert.match(text, /### Documentation\n\n- clarify deployment \(ccc333\)/u);
  assert.match(text, /### Other Changes\n\n- unmapped subject \(ddd444\)/u);
  assert.match(text, /Web tag: `web-0\.2\.1-rc\.3`; Tavern tag: `tavern-3\.1`/u);
  assert.match(text, /## \[0\.2\.1-rc\.2-r2\]/u);
});

test('prepare-release rejects duplicate versions and non-version input', () => {
  assert.throws(() => validateVersion('release-latest'), /SemVer-like/u);
  assert.throws(() => renderChangelog({
    version: '0.2.1-rc.3',
    date: '2026-10-22',
    webTag: 'web-0.2.1-rc.3',
    tavernTag: 'tavern-3.1',
    baseTag: 'web-0.2.1-rc.2-r2',
    commits: [parseCommitLine('aaa111\tfeat: next')],
    previous: '# Changelog\n\n## [0.2.1-rc.3] - 2026-10-21\n',
  }), /already contains/u);
});
