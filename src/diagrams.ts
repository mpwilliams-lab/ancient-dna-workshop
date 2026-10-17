// D2's own diagram (spec §3.2, P1): father -> son on the Y-chromosome line, mother -> all her children on the
// mitochondrial line. Squares are males and circles females (the usual family-tree convention). Colours are SVG
// attributes: style.css never sets fill or stroke (tests/shell-css.test.ts).
import type { DiagramId } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const DIAGRAM_VIEW = { width: 760, height: 210 } as const;

const FATHER_LINE = '#1f5f99';
const MOTHER_LINE = '#b45309';
const INK = '#1b1f23';
const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';

export function renderDiagram(doc: Document, id: DiagramId, labels: readonly string[]): SVGSVGElement {
  if (id !== 'fatherMotherLines') throw new Error(`renderDiagram: unknown diagram "${String(id)}"`);
  if (labels.length !== 2) throw new Error(`renderDiagram: fatherMotherLines needs 2 labels, got ${labels.length}`);
  const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${DIAGRAM_VIEW.width} ${DIAGRAM_VIEW.height}`);
  svg.setAttribute('class', 'diagram-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${labels[0]}. ${labels[1]}`);
  svg.setAttribute('preserveAspectRatio', 'xMinYMid meet');

  const add = (tag: string, attrs: Record<string, string | number>): SVGElement => {
    const e = doc.createElementNS(SVG_NS, tag) as SVGElement;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    svg.append(e);
    return e;
  };
  const label = (x: number, y: number, text: string): void => {
    const t = add('text', { x, y, 'font-size': 20, 'font-family': FONT, fill: INK, 'dominant-baseline': 'middle' });
    t.textContent = text;
  };

  // Row 1: Y chromosome, father -> son.
  add('rect', { x: 30, y: 35, width: 40, height: 40, rx: 4, fill: FATHER_LINE, stroke: INK, 'stroke-width': 1.5 });
  add('line', { x1: 74, y1: 55, x2: 170, y2: 55, stroke: FATHER_LINE, 'stroke-width': 6, 'stroke-linecap': 'round' });
  add('polygon', { points: '168,43 188,55 168,67', fill: FATHER_LINE });
  add('rect', { x: 194, y: 35, width: 40, height: 40, rx: 4, fill: FATHER_LINE, stroke: INK, 'stroke-width': 1.5 });
  label(262, 55, labels[0]!);

  // Row 2: mitochondrial DNA, mother -> every child (daughter, son, daughter).
  add('circle', { cx: 50, cy: 150, r: 21, fill: MOTHER_LINE, stroke: INK, 'stroke-width': 1.5 });
  for (const y of [118, 150, 182]) add('line', { x1: 72, y1: 150, x2: 182, y2: y, stroke: MOTHER_LINE, 'stroke-width': 4, 'stroke-linecap': 'round' });
  add('circle', { cx: 200, cy: 118, r: 14, fill: MOTHER_LINE, stroke: INK, 'stroke-width': 1.5 });
  add('rect', { x: 186, y: 136, width: 28, height: 28, rx: 3, fill: MOTHER_LINE, stroke: INK, 'stroke-width': 1.5 });
  add('circle', { cx: 200, cy: 182, r: 14, fill: MOTHER_LINE, stroke: INK, 'stroke-width': 1.5 });
  label(262, 150, labels[1]!);
  return svg;
}
