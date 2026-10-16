import test from 'node:test';
import assert from 'node:assert/strict';
import { filterNotes, notesMarkdown, noteSection } from '../src/lib/reader-notes.ts';
import { isHighlightEdit } from '../src/lib/highlights.ts';
const notes = [
  { id: 'one', seat: 1, quote: 'Mara found a book', comment: 'Моя думка', section: 'The morning walk', target: null },
  { id: 'two', seat: 2, quote: 'Partner quote', comment: 'Private partner comment', section: 'Coming home', target: null },
];
test('notes search combines author with Unicode quote, comment and section matching', () => {
  const chapters = [{ index: null, label: 'Part', children: [{ index: 0, label: 'Chapter with relative anchor', children: [] }] }];
  assert.equal(noteSection(chapters, 0), 'Chapter with relative anchor');
  assert.equal(noteSection(chapters, 2), 'Section 3');
  assert.deepEqual(filterNotes(notes, 1, 'mine', ' ДУМКА ').map(n => n.id), ['one']);
  assert.deepEqual(filterNotes(notes, 1, 'all', 'morning').map(n => n.id), ['one']);
  assert.deepEqual(filterNotes(notes, 1, 'partner', 'book'), []);
  assert.deepEqual(filterNotes(notes, 2, 'mine', '').map(n => n.id), ['two']);
  assert.deepEqual(filterNotes(notes, 1, 'all', 'ＭＡＲＡ').map(n => n.id), ['one']);
});
test('Markdown exports only the owner and treats embedded HTML and Markdown as literal text', () => {
  const output = notesMarkdown('Book <script>\nTitle', [...notes, { ...notes[0], quote: '![remote](https://evil.test/image)\n<img src=x>', comment: '**bold** & note' }], 1);
  assert.ok(output.includes('Моя думка'));
  assert.ok(!output.includes('Partner quote')); assert.ok(!output.includes('Private partner comment'));
  assert.ok(!output.includes('<script>')); assert.ok(!output.includes('<img'));
  assert.ok(output.includes('\\!\\[remote\\]\\(https://evil\\.test/image\\)'));
  assert.ok(output.includes('> &lt;img src=x\\>')); assert.ok(output.includes('\\*\\*bold\\*\\* &amp; note'));
  assert.ok(!output.includes('target')); assert.ok(!output.includes('epubcfi'));
});
test('comment edit requires a bounded original value for safe conflict detection', () => {
  const edit = { id: '12345678-1234-1234-1234-123456789abc', comment: '', previousComment: 'old' };
  assert.equal(isHighlightEdit(edit), true);
  for (const invalid of [null, { ...edit, previousComment: null }, { ...edit, comment: 'x'.repeat(1001) }, { ...edit, id: 'other' }]) assert.equal(isHighlightEdit(invalid), false);
});
