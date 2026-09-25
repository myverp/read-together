export type Point = [number, number];
export type Stroke = { width: number; points: Point[]; color?: string };
export type TextRun = { text: string; x: number; y: number; width: number; height: number; family: string; size: number; weight: string; style: string; color: string };
export type PageSnapshot = { width: number; height: number; runs: TextRun[] };
export type Drawing = { id: string; cfi: string; anchor: Point; page: PageSnapshot; strokes: Stroke[]; color: string; seat: 1 | 2 };
export type DrawingInput = Omit<Drawing, 'seat' | 'color' | 'strokes'> & { strokes: (Stroke & { color: string })[] };
export type DrawingState = { revision: number; items: Drawing[] };
export const DRAWING_COLORS = [
  '#FF1744', '#FF6D00', '#FFD600', '#00C853', '#00BFA5',
  '#00B0FF', '#2962FF', '#651FFF', '#D500F9', '#F50057',
] as const;
const finite = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const point = (p: unknown, width: number, height: number): p is Point => Array.isArray(p) && p.length === 2 && finite(p[0], 0, width) && finite(p[1], 0, height);
export function isDrawingInput(value: unknown): value is DrawingInput {
  if (!value || typeof value !== 'object') return false;
  const d = value as DrawingInput;
  if (typeof d.id !== 'string' || !/^[a-f0-9-]{36}$/.test(d.id) ||
      typeof d.cfi !== 'string' || d.cfi.length > 4096 || !/^epubcfi\([^\r\n]+\)$/.test(d.cfi) ||
      !d.page || !finite(d.page.width, 100, 4000) || !finite(d.page.height, 100, 4000) ||
      !point(d.anchor, d.page.width, d.page.height) ||
      !Array.isArray(d.strokes) || d.strokes.length < 1 || d.strokes.length > 80 ||
      !Array.isArray(d.page.runs) || d.page.runs.length < 1 || d.page.runs.length > 600) return false;
  if (d.strokes.reduce((sum, stroke) => sum + (stroke && typeof stroke === 'object' && Array.isArray(stroke.points) ? stroke.points.length : 10000), 0) > 3000) return false;
  if (!d.strokes.every(stroke => stroke && typeof stroke === 'object' && DRAWING_COLORS.includes(stroke.color as typeof DRAWING_COLORS[number]) &&
    finite(stroke.width, 1, 16) && Array.isArray(stroke.points) && stroke.points.length > 0 && stroke.points.length <= 1000 &&
    stroke.points.every(p => point(p, d.page.width, d.page.height)))) return false;
  return d.page.runs.every(run => run && typeof run === 'object' && typeof run.text === 'string' && run.text.length > 0 && run.text.length <= 100 &&
    finite(run.x, -4000, 4000) && finite(run.y, -4000, 4000) && finite(run.width, 0, 4000) && finite(run.height, 0, 4000) &&
    finite(run.size, 4, 100) && typeof run.family === 'string' && run.family.length <= 120 &&
    typeof run.weight === 'string' && run.weight.length <= 20 && typeof run.style === 'string' && run.style.length <= 20 &&
    typeof run.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(run.color));
}
export function pathFor(stroke: Stroke) {
  if (stroke.points.length === 1) { const [x, y] = stroke.points[0]; return `M${x.toFixed(1)} ${y.toFixed(1)}l0.1 0`; }
  return stroke.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') || '';
}
