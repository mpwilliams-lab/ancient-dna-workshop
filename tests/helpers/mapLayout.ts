// An independent check of how the labels of a dot map lie on it (Task 24; tests/maps.test.ts and tests/real-data.test.ts). It measures with
// labelBox (src/maps.ts, the estimate of a label's box that the placer and the card's end-to-end proof share) and nothing else from the placer.
import { labelBox } from '../../src/maps';
import { MAP_FRAMES, MAP_VIEW, dotRadius, makeProjection, project, type MapProjectionConstants, type MapSpec, type MapText, type MapView } from '../../src/plots/map';

export interface Dot { x: number; y: number; r: number }
interface Box { left: number; right: number; top: number; bottom: number }

/** From a point to the nearest point of a box (0 inside it). */
export const distanceToBox = (x: number, y: number, b: Box): number =>
  Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));

const overlaps = (a: Box, b: Box): boolean =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;

/**
 * What is wrong with `texts` (label i belongs to dot i) on a map drawn in `view`, as readable lines; [] when nothing is:
 * every label and every dot (a stroke is drawn beyond its radius, so one more unit) lies inside the window, no two labels overlap, no
 * label covers any dot (its own included), and each label is nearer to its own dot than to any other, so no reader can mistake whose
 * number it is. `widthFactor` draws every word that much wider than labelBox's estimate, from the edge it is anchored at (1: as
 * estimated), for the overlap, cover and nearest-dot checks: the slack the placer keeps for a font that draws wider than measured.
 */
export function labelLayoutViolations(
  c: MapProjectionConstants, view: MapView, fontPx: number, dots: readonly Dot[], texts: readonly MapText[], widthFactor = 1,
): string[] {
  const out: string[] = [];
  const boxes = texts.map((t) => labelBox(c, t, fontPx));
  const widened = boxes.map((b, i): Box => {
    const w = (b.right - b.left) * widthFactor;
    const anchor = texts[i]!.anchor ?? 'middle';
    if (anchor === 'start') return { ...b, right: b.left + w };
    if (anchor === 'end') return { ...b, left: b.right - w };
    const mid = (b.left + b.right) / 2;
    return { ...b, left: mid - w / 2, right: mid + w / 2 };
  });
  const inside = (b: Box): boolean => b.left >= view.x && b.right <= view.x + view.width && b.top >= view.y && b.bottom <= view.y + view.height;
  if (texts.length !== dots.length) out.push(`${texts.length} labels for ${dots.length} dots`);
  dots.forEach((d, i) => {
    if (!inside({ left: d.x - d.r - 1, right: d.x + d.r + 1, top: d.y - d.r - 1, bottom: d.y + d.r + 1 })) out.push(`the dot of "${texts[i]?.text}" leaves the window`);
  });
  boxes.forEach((b, i) => {
    const name = texts[i]!.text;
    const wide = widened[i]!;
    if (!inside(b)) out.push(`"${name}" leaves the window`);
    for (let j = i + 1; j < boxes.length; j++) if (overlaps(wide, widened[j]!)) out.push(`"${name}" overlaps "${texts[j]!.text}"`);
    dots.forEach((d, k) => {
      if (distanceToBox(d.x, d.y, wide) < d.r + 1) out.push(k === i ? `"${name}" covers its own dot` : `"${name}" covers the dot of "${texts[k]?.text}"`);
    });
    const own = dots[i];
    if (own !== undefined) {
      const dOwn = distanceToBox(own.x, own.y, wide);
      dots.forEach((d, k) => {
        if (k !== i && distanceToBox(d.x, d.y, wide) <= dOwn) out.push(`"${name}" is as near the dot of "${texts[k]?.text}" as to its own`);
      });
    }
  });
  return out;
}

/** The dots of a map spec as the renderer draws them: centre in map units, radius by dotRadius. */
export function specDots(spec: MapSpec): Dot[] {
  const c = makeProjection(MAP_FRAMES[spec.frame]);
  return (spec.points ?? []).map((p) => {
    const q = project(c, p.lat, p.lon);
    return { x: q.x, y: q.y, r: dotRadius(p.value ?? 0, spec.scaleMax ?? 100) };
  });
}

/** labelLayoutViolations for a spec: its window (the whole 1000 x 700 map space when it has none), its label size and its dots. */
export function layoutViolations(spec: MapSpec, widthFactor = 1): string[] {
  const c = makeProjection(MAP_FRAMES[spec.frame]);
  const view = spec.view ?? { x: 0, y: 0, width: MAP_VIEW.width, height: MAP_VIEW.height };
  return labelLayoutViolations(c, view, spec.labelPx ?? 20, specDots(spec), spec.texts ?? [], widthFactor);
}
