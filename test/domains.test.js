import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRules, findMatch, normalizeDomain, parseList } from '../extension/lib/domains.js';

test('normalizeDomain strips scheme, www, path and case', () => {
  assert.equal(normalizeDomain('https://www.YouTube.com/watch?v=1'), 'youtube.com');
  assert.equal(normalizeDomain('vk.com'), 'vk.com');
  assert.equal(normalizeDomain('m.reddit.com:8080/r/all'), 'm.reddit.com');
  assert.equal(normalizeDomain('пример.рф'), 'xn--e1afmkfd.xn--p1ai');
});

test('normalizeDomain rejects things that are not domains', () => {
  for (const bad of ['', 'localhost', 'not a site', 'http://', '-bad-.com']) {
    assert.equal(normalizeDomain(bad), null, bad);
  }
});

test('parseList splits by lines, commas and spaces and reports invalid entries', () => {
  const { domains, invalid } = parseList('youtube.com, vk.com\nhttps://www.youtube.com  oops');
  assert.deepEqual(domains, ['youtube.com', 'vk.com']);
  assert.deepEqual(invalid, ['oops']);
});

test('subdomains match their parent but look-alikes do not', () => {
  const list = ['youtube.com', 'x.com'];
  assert.equal(findMatch('m.youtube.com', list), 'youtube.com');
  assert.equal(findMatch('notyoutube.com', list), null);
  assert.equal(findMatch('x.com.', list), 'x.com');
});

test('one redirect rule per domain with a regex that covers subdomains only', () => {
  const rules = buildRules(['youtube.com', 'vk.com'], 'chrome-extension://abc/blocked.html');
  assert.equal(rules.length, 2);
  assert.deepEqual(rules.map((r) => r.id), [1, 2]);
  const [yt] = rules;
  assert.deepEqual(yt.condition.resourceTypes, ['main_frame']);
  assert.equal(yt.action.redirect.regexSubstitution, 'chrome-extension://abc/blocked.html?site=youtube.com#\\0');
  const re = new RegExp(yt.condition.regexFilter);
  assert.ok(re.test('https://youtube.com/'));
  assert.ok(re.test('https://www.youtube.com/watch?v=1'));
  assert.ok(re.test('http://m.youtube.com:8080'));
  assert.ok(!re.test('https://notyoutube.com/'));
  assert.ok(!re.test('https://youtube.com.evil.io/'));
});
