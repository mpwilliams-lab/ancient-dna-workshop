// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DIAGRAM_VIEW, renderDiagram } from '../src/diagrams';
import { CARDS } from '../src/cards';
import { ruleViolations } from './contentRules';

describe('D2 father-line / mother-line diagram (spec §3.2, own SVG, P1)', () => {
  const labels = CARDS.D2.diagram!.labels;
  const svg = renderDiagram(document, 'fatherMotherLines', labels);

  it('is an inline SVG with a fixed viewBox and an accessible name made of its two labels', () => {
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${DIAGRAM_VIEW.width} ${DIAGRAM_VIEW.height}`);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe(`${labels[0]}. ${labels[1]}`);
  });
  it('shows each label whole, in one <text> element, in order', () => {
    expect([...svg.querySelectorAll('text')].map((t) => t.textContent)).toEqual(['Y chromosome: father → son', 'Mitochondrial DNA: mother → all her children']);
    for (const l of labels) expect(ruleViolations(l)).toEqual([]);
  });
  it('draws a father and a son (squares) on the Y line, a mother and three children (two daughters, one son) on the mother-line', () => {
    expect(svg.querySelectorAll('rect')).toHaveLength(3);      // father, son, the mother's son
    expect(svg.querySelectorAll('circle')).toHaveLength(3);    // mother, two daughters
    expect(svg.querySelectorAll('line')).toHaveLength(4);      // father -> son, mother -> each child
    expect(svg.querySelectorAll('polygon')).toHaveLength(1);   // arrowhead on the father -> son line
  });
  it('colours come from attributes, never from CSS (the stylesheet sets no fill or stroke)', () => {
    for (const e of svg.querySelectorAll('rect, circle, line, polygon')) {
      expect(e.getAttribute('fill') ?? e.getAttribute('stroke')).toBeTruthy();
      expect(e.getAttribute('style')).toBeNull();
    }
  });
  it('refuses an unknown diagram or a wrong label count', () => {
    expect(() => renderDiagram(document, 'nope' as never, labels)).toThrow();
    expect(() => renderDiagram(document, 'fatherMotherLines', [labels[0]!])).toThrow();
  });
});
