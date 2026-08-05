import { Vector2, vec2 } from '../types/geometry';
import { Slice, Contour, RodHole, isPointInContour } from '../types/slice';
import { PackablePiece, BoundingBox2D } from './types';

// Number of segments to approximate a circle for rod holes
const CIRCLE_SEGMENTS = 16;

// Default tolerance for contour simplification (in mm)
const SIMPLIFY_TOLERANCE = 0.5;

/**
 * Calculate perpendicular distance from a point to a line segment
 */
function perpendicularDistance(point: Vector2, lineStart: Vector2, lineEnd: Vector2): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  // Handle degenerate case where line start and end are the same
  const lineLengthSq = dx * dx + dy * dy;
  if (lineLengthSq === 0) {
    const pdx = point.x - lineStart.x;
    const pdy = point.y - lineStart.y;
    return Math.sqrt(pdx * pdx + pdy * pdy);
  }

  // Calculate perpendicular distance using cross product
  const numerator = Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x);
  return numerator / Math.sqrt(lineLengthSq);
}

/**
 * Simplify a contour using the Douglas-Peucker algorithm.
 * Reduces the number of vertices while preserving the overall shape.
 *
 * @param points - Array of points forming the contour
 * @param tolerance - Maximum distance a point can deviate from the simplified line (in mm)
 * @returns Simplified array of points
 */
export function simplifyContour(points: Vector2[], tolerance: number = SIMPLIFY_TOLERANCE): Vector2[] {
  if (points.length <= 2) {
    return points;
  }

  // Find the point with the maximum distance from the line between first and last points
  let maxDistance = 0;
  let maxIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  // If the maximum distance is greater than tolerance, recursively simplify
  if (maxDistance > tolerance) {
    // Recursively simplify the two halves
    const left = simplifyContour(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyContour(points.slice(maxIndex), tolerance);

    // Combine results (remove duplicate point at the junction)
    return left.slice(0, -1).concat(right);
  } else {
    // All points are close enough to the line, return just the endpoints
    return [first, last];
  }
}

/**
 * Convert a rod hole to a polygon approximation
 */
function rodHoleToPolygon(hole: RodHole): Vector2[] {
  const points: Vector2[] = [];
  const radius = hole.diameter / 2;

  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    points.push(vec2(
      hole.center.x + Math.cos(angle) * radius,
      hole.center.y + Math.sin(angle) * radius
    ));
  }

  return points;
}

/**
 * Calculate the bounding box of a contour
 */
function computeBoundingBox(points: Vector2[]): BoundingBox2D {
  if (points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  return { minX, maxX, minY, maxY };
}

/**
 * Calculate the centroid of a polygon
 */
function computeCentroid(points: Vector2[]): Vector2 {
  if (points.length === 0) {
    return vec2(0, 0);
  }

  let cx = 0, cy = 0;
  let signedArea = 0;

  for (let i = 0; i < points.length; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % points.length];
    const a = p0.x * p1.y - p1.x * p0.y;
    signedArea += a;
    cx += (p0.x + p1.x) * a;
    cy += (p0.y + p1.y) * a;
  }

  signedArea *= 0.5;

  if (Math.abs(signedArea) < 1e-10) {
    // Degenerate polygon, use simple average
    let sumX = 0, sumY = 0;
    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
    }
    return vec2(sumX / points.length, sumY / points.length);
  }

  cx /= (6 * signedArea);
  cy /= (6 * signedArea);

  return vec2(cx, cy);
}

/**
 * Calculate signed area of a polygon
 */
function computeSignedArea(points: Vector2[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }

  return area / 2;
}

/**
 * Check if one contour is inside another
 */
function isContourInside(inner: Contour, outer: Contour): boolean {
  // Check if any point of inner is inside outer
  // Using the first point as representative
  if (inner.points.length === 0) return false;
  return isPointInContour(inner.points[0], outer);
}

/**
 * Find holes that belong to a given outer contour
 */
function findHolesForContour(
  outerContour: Contour,
  allHoles: Contour[],
  rodHoles: RodHole[]
): Vector2[][] {
  const holes: Vector2[][] = [];

  // Find contour holes
  for (const hole of allHoles) {
    if (isContourInside(hole, outerContour)) {
      holes.push(hole.points);
    }
  }

  // Find rod holes that are inside this contour
  for (const rodHole of rodHoles) {
    if (isPointInContour(rodHole.center, outerContour)) {
      holes.push(rodHoleToPolygon(rodHole));
    }
  }

  return holes;
}

/**
 * Extract packable pieces from a slice
 * A slice may have multiple disconnected outer contours, each becomes a separate piece
 */
export function extractPiecesFromSlice(slice: Slice): PackablePiece[] {
  const pieces: PackablePiece[] = [];

  // Separate outer contours from holes
  const outerContours: Contour[] = [];
  const holes: Contour[] = [];

  for (const contour of slice.contours) {
    if (contour.isHole) {
      holes.push(contour);
    } else {
      outerContours.push(contour);
    }
  }

  // Create a piece for each outer contour
  for (let i = 0; i < outerContours.length; i++) {
    const outer = outerContours[i];
    const pieceHoles = findHolesForContour(outer, holes, slice.rodHoles);

    const boundingBox = computeBoundingBox(outer.points);
    const area = Math.abs(computeSignedArea(outer.points));
    const centroid = computeCentroid(outer.points);

    pieces.push({
      id: `layer${slice.layerIndex}_piece${i}`,
      layerIndex: slice.layerIndex,
      outerContour: outer.points,
      holes: pieceHoles,
      boundingBox,
      area,
      centroid,
    });
  }

  return pieces;
}

/**
 * Extract all packable pieces from multiple slices
 */
export function extractPiecesFromSlices(slices: Slice[]): PackablePiece[] {
  const allPieces: PackablePiece[] = [];

  for (const slice of slices) {
    const pieces = extractPiecesFromSlice(slice);
    allPieces.push(...pieces);
  }

  return allPieces;
}

/**
 * Translate a piece's contours by the given offset
 * Returns new points, does not modify original
 */
export function translatePiece(piece: PackablePiece, dx: number, dy: number): {
  outerContour: Vector2[];
  holes: Vector2[][];
  centroid: Vector2;
} {
  return {
    outerContour: piece.outerContour.map(p => vec2(p.x + dx, p.y + dy)),
    holes: piece.holes.map(hole => hole.map(p => vec2(p.x + dx, p.y + dy))),
    centroid: vec2(piece.centroid.x + dx, piece.centroid.y + dy),
  };
}

/**
 * Rotate a piece's contours around a point
 * Returns new points, does not modify original
 */
export function rotatePiece(piece: PackablePiece, angle: number, center?: Vector2): {
  outerContour: Vector2[];
  holes: Vector2[][];
  centroid: Vector2;
  boundingBox: BoundingBox2D;
} {
  const cx = center?.x ?? piece.centroid.x;
  const cy = center?.y ?? piece.centroid.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const rotatePoint = (p: Vector2): Vector2 => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return vec2(
      cx + dx * cos - dy * sin,
      cy + dx * sin + dy * cos
    );
  };

  const outerContour = piece.outerContour.map(rotatePoint);
  const holes = piece.holes.map(hole => hole.map(rotatePoint));
  const centroid = rotatePoint(piece.centroid);
  const boundingBox = computeBoundingBox(outerContour);

  return { outerContour, holes, centroid, boundingBox };
}

/**
 * Get the bounding box of a piece after rotation
 */
export function getRotatedBoundingBox(piece: PackablePiece, angle: number): BoundingBox2D {
  const { boundingBox } = rotatePiece(piece, angle);
  return boundingBox;
}
