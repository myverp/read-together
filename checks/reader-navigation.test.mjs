import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterTarget, bookChapters } from '../src/lib/reader-navigation.ts';
const sections = [{ href: 'text/one.xhtml', index: 0, linear: true }, { href: 'two.xhtml', index: 1, linear: true }];
const book = { packaging: { navPath: 'nav/toc.xhtml' }, resolve: path => new URL(path, 'https://epub.invalid/OEBPS/').pathname,
  spine: { each: fn => sections.forEach(fn) }, navigation: { toc: [] } };
test('navigation-relative paths and fragments resolve only to this spine', () => {
  assert.deepEqual(chapterTarget(book, '../text/./one.xhtml#river'), { target: 'text/one.xhtml#river', index: 0 });
  for (const href of ['https://example.com/two.xhtml', '//example.com', 'javascript:alert(1)', 'data:text/html,x', '../missing.xhtml', '../../two.xhtml', '../two.xhtml?x=1', '../text/%ZZ.xhtml', '\\two.xhtml']) assert.equal(chapterTarget(book, href), null, href);
});
test('invalid parent retains valid children; empty or unusable TOC falls back to linear spine', () => {
  const nested = { ...book, navigation: { toc: [{ href: 'bad.xhtml', label: '<b>Plain text</b>', subitems: [{ href: '../two.xhtml', label: 'Two', subitems: [] }] }] } };
  assert.equal(bookChapters(nested)[0].target, null);
  assert.equal(bookChapters(nested)[0].children[0].target, 'two.xhtml');
  assert.deepEqual(bookChapters(book).map(item => item.label), ['Section 1', 'Section 2']);
});
