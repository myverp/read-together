import { EpubCFI, type Contents, type Rendition } from 'epubjs';
import type { PageSnapshot, Point, Stroke, TextRun } from './drawings';

function hexColor(value: string): string {
  const match = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  return match?.length === 3 ? `#${match.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}` : '#1d1d1f';
}

/** Freeze visible word geometry from the inert EPUB document, with no saved markup. */
export type CapturedPage = { page: PageSnapshot; candidates: { point: Point; range: Range; content: Contents }[] };
export function captureDrawingPage(reader: Rendition, viewer: HTMLElement): CapturedPage {
  const box = viewer.getBoundingClientRect();
  if (box.width < 100 || box.height < 100) throw new Error('Wait for the page to finish opening.');
  const runs: TextRun[] = [];
  const candidates: CapturedPage['candidates'] = [];
  const contents = reader.getContents() as unknown as Contents[];
  for (const content of contents) {
    const frame = content.window.frameElement?.getBoundingClientRect();
    if (!frame) continue;
    const doc = content.document;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.textContent?.trim() || node.parentElement?.closest('script,style,noscript,[hidden],[aria-hidden="true"]')) continue;
      const style = content.window.getComputedStyle(node.parentElement!);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const nodeRange = doc.createRange(); nodeRange.selectNodeContents(node);
      if (!Array.from(nodeRange.getClientRects()).some(rect => {
        const x = frame.left - box.left + rect.left, y = frame.top - box.top + rect.top;
        return x + rect.width >= 0 && y + rect.height >= 0 && x <= box.width && y <= box.height;
      })) continue;
      const words = node.textContent.matchAll(/\S+/g);
      for (const word of words) {
        const range = doc.createRange();
        range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
        const rect = range.getBoundingClientRect();
        const x = frame.left - box.left + rect.left;
        const y = frame.top - box.top + rect.top;
        if (!rect.width || !rect.height || x + rect.width < 0 || y + rect.height < 0 || x > box.width || y > box.height) continue;
        const run: TextRun = { text: word[0].slice(0, 100), x, y, width: rect.width, height: rect.height,
          family: style.fontFamily.slice(0, 120), size: Math.min(100, Math.max(4, Number.parseFloat(style.fontSize) || 18)),
          weight: style.fontWeight.slice(0, 20), style: style.fontStyle.slice(0, 20), color: hexColor(style.color) };
        runs.push(run);
        candidates.push({ point: [x + rect.width / 2, y + rect.height / 2], range, content });
        if (runs.length >= 600) break;
      }
      if (runs.length >= 600) break;
    }
    if (runs.length >= 600) break;
  }
  if (!runs.length || !candidates.length) throw new Error('This page has no readable text to anchor a drawing.');
  return { page: { width: box.width, height: box.height, runs }, candidates };
}

export function anchorNearStrokes(captured: CapturedPage, strokes: Stroke[]): { cfi: string; anchor: Point } {
  const points = strokes.flatMap(stroke => stroke.points);
  const center: Point = [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
  for (const candidate of [...captured.candidates].sort((a, b) => Math.hypot(a.point[0] - center[0], a.point[1] - center[1]) - Math.hypot(b.point[0] - center[0], b.point[1] - center[1]))) {
    try { return { cfi: candidate.content.cfiFromRange(candidate.range), anchor: candidate.point }; } catch { /* Try the next word. */ }
  }
  throw new Error('Could not anchor this drawing to the page.');
}

export function drawingAnchor(reader: Rendition, viewer: HTMLElement, cfi: string): Point | null {
  const box = viewer.getBoundingClientRect();
  let section: number;
  try { section = new EpubCFI(cfi).spinePos; } catch { return null; }
  for (const content of reader.getContents() as unknown as Contents[]) {
    if (content.sectionIndex !== section) continue;
    const frame = content.window.frameElement?.getBoundingClientRect();
    if (!frame) continue;
    try {
      const rect = content.range(cfi).getBoundingClientRect();
      const x = frame.left - box.left + rect.left + rect.width / 2;
      const y = frame.top - box.top + rect.top + rect.height / 2;
      if (rect.width && rect.height && x >= 0 && x <= box.width && y >= 0 && y <= box.height) return [x, y];
    } catch { /* CFI belongs to another section. */ }
  }
  return null;
}
