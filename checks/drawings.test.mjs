import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isDrawingInput, pathFor } from '../src/lib/drawings.ts';
const valid = () => ({ id: randomUUID(), cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', anchor: [50, 60],
  page: { width: 300, height: 400, runs: [{ text: 'Word', x: 20, y: 30, width: 45, height: 21,
    family: 'Georgia', size: 18, weight: '400', style: 'normal', color: '#1d1d1f' }] },
  strokes: [{ width: 3, points: [[50, 60], [51, 62]] }] });
test('drawing validator accepts bounded geometry and rejects malformed nested data', () => {
  assert.equal(isDrawingInput(valid()), true);
  for (const mutate of [
    d => { d.strokes[0] = null; },
    d => { d.page.runs[0] = null; },
    d => { d.strokes[0].points = [[Number.NaN, 30]]; },
    d => { d.strokes[0].points = [[9999, 30]]; },
    d => { d.page.runs[0].text = '<script>'.repeat(100); },
    d => { d.page.runs[0].color = 'url(javascript:alert(1))'; },
    d => { d.cfi = 'javascript:alert(1)'; },
    d => { d.strokes = []; },
  ]) { const input = valid(); mutate(input); assert.equal(isDrawingInput(input), false); }
  assert.match(pathFor({ width: 3, points: [[5, 7]] }), /l0\.1 0$/);
});
