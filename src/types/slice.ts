import { Vector2 } from './geometry';

export interface Segment {
  p0: Vector2;
  p1: Vector2;
}

export interface Contour {
  points: Vector2[];
  isHole: boolean;
  area: number;
}

export interface Slice {
  layerIndex: number;
  zHeight: number;
  contours: Contour[];
  floatingSections: number[]; // Indices of contours that are floating (unsupported from below)
  rodHoles: RodHole[];
}

export interface RodHole {
  center: Vector2;
  diameter: number;
  rodId: string;
}

export interface SliceConfig {
  thickness: number; // Layer thickness in mm
  startZ?: number;   // Starting Z position (defaults to mesh min Z)
  endZ?: number;     // Ending Z position (defaults to mesh max Z)
}

export interface SliceResult {
  slices: Slice[];
  layerCount: number;
  modelHeight: number;
  boundingBox: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
}

export function computeContourArea(points: Vector2[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }

  return area / 2;
}

export function isPointInContour(point: Vector2, contour: Contour): boolean {
  const { points } = contour;
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;

    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

export function contourBoundingBox(contour: Contour): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const p of contour.points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  return { minX, maxX, minY, maxY };
}

export function doContoursOverlap(c1: Contour, c2: Contour): boolean {
  const bb1 = contourBoundingBox(c1);
  const bb2 = contourBoundingBox(c2);

  // Quick bounding box check
  if (bb1.maxX < bb2.minX || bb2.maxX < bb1.minX ||
      bb1.maxY < bb2.minY || bb2.maxY < bb1.minY) {
    return false;
  }

  // Check if any point from c1 is inside c2 or vice versa
  for (const p of c1.points) {
    if (isPointInContour(p, c2)) return true;
  }
  for (const p of c2.points) {
    if (isPointInContour(p, c1)) return true;
  }

  // Check for edge intersections
  for (let i = 0; i < c1.points.length; i++) {
    const a1 = c1.points[i];
    const a2 = c1.points[(i + 1) % c1.points.length];

    for (let j = 0; j < c2.points.length; j++) {
      const b1 = c2.points[j];
      const b2 = c2.points[(j + 1) % c2.points.length];

      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }

  return false;
}

function segmentsIntersect(a1: Vector2, a2: Vector2, b1: Vector2, b2: Vector2): boolean {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

function direction(p1: Vector2, p2: Vector2, p3: Vector2): number {
  return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
}
