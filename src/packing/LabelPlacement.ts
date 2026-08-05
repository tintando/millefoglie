import { Vector2, vec2 } from '../types/geometry';
import { Contour, isPointInContour, contourBoundingBox } from '../types/slice';
import { getNumberBoundingBox } from './SingleStrokeFont';
import { PlacedPiece } from './types';
import { rotatePiece } from './PieceExtractor';

export interface LabelPlacement {
  position: Vector2;
  height: number;
  width: number;
  type: 'inside' | 'hole' | 'external';
}

export interface PlacedLabel {
  position: Vector2;
  width: number;
  height: number;
}

export interface LabelPlacementConfig {
  preferredHeight: number;     // Default 5mm
  minimumHeight: number;       // Default 2mm
  heightSteps: number[];       // [5, 4, 3, 2]
  searchGridSize: number;      // 2mm
  labelPadding: number;        // 0.5mm margin from edges
}

export const DEFAULT_LABEL_CONFIG: LabelPlacementConfig = {
  preferredHeight: 5,
  minimumHeight: 2,
  heightSteps: [5, 4, 3, 2],
  searchGridSize: 2,
  labelPadding: 0.5,
};

/**
 * Test if a line segment intersects an axis-aligned rectangle
 */
function segmentIntersectsRectangle(
  p1: Vector2,
  p2: Vector2,
  center: Vector2,
  halfW: number,
  halfH: number
): boolean {
  const minX = center.x - halfW;
  const maxX = center.x + halfW;
  const minY = center.y - halfH;
  const maxY = center.y + halfH;

  // Check if segment is entirely outside rectangle bounds
  if ((p1.x < minX && p2.x < minX) || (p1.x > maxX && p2.x > maxX)) return false;
  if ((p1.y < minY && p2.y < minY) || (p1.y > maxY && p2.y > maxY)) return false;

  // Check if either endpoint is inside the rectangle
  const p1Inside = p1.x >= minX && p1.x <= maxX && p1.y >= minY && p1.y <= maxY;
  const p2Inside = p2.x >= minX && p2.x <= maxX && p2.y >= minY && p2.y <= maxY;
  if (p1Inside || p2Inside) return true;

  // Check intersection with all 4 rectangle edges
  // Left edge
  if (lineSegmentsIntersect(p1, p2, vec2(minX, minY), vec2(minX, maxY))) return true;
  // Right edge
  if (lineSegmentsIntersect(p1, p2, vec2(maxX, minY), vec2(maxX, maxY))) return true;
  // Bottom edge
  if (lineSegmentsIntersect(p1, p2, vec2(minX, minY), vec2(maxX, minY))) return true;
  // Top edge
  if (lineSegmentsIntersect(p1, p2, vec2(minX, maxY), vec2(maxX, maxY))) return true;

  return false;
}

/**
 * Check if two line segments intersect
 */
function lineSegmentsIntersect(a1: Vector2, a2: Vector2, b1: Vector2, b2: Vector2): boolean {
  const d1 = crossProduct(b1, b2, a1);
  const d2 = crossProduct(b1, b2, a2);
  const d3 = crossProduct(a1, a2, b1);
  const d4 = crossProduct(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

function crossProduct(p1: Vector2, p2: Vector2, p3: Vector2): number {
  return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
}

/**
 * Check if two axis-aligned rectangles overlap
 */
function rectanglesOverlap(
  c1: Vector2, w1: number, h1: number,
  c2: Vector2, w2: number, h2: number,
  padding: number = 0
): boolean {
  const halfW1 = (w1 + padding) / 2;
  const halfH1 = (h1 + padding) / 2;
  const halfW2 = (w2 + padding) / 2;
  const halfH2 = (h2 + padding) / 2;

  return !(
    c1.x + halfW1 < c2.x - halfW2 ||
    c1.x - halfW1 > c2.x + halfW2 ||
    c1.y + halfH1 < c2.y - halfH2 ||
    c1.y - halfH1 > c2.y + halfH2
  );
}

/**
 * Check if a label rectangle overlaps any already-placed labels
 */
export function labelOverlapsPlacedLabels(
  center: Vector2,
  width: number,
  height: number,
  placedLabels: PlacedLabel[],
  padding: number = 0
): boolean {
  for (const placed of placedLabels) {
    if (rectanglesOverlap(center, width, height, placed.position, placed.width, placed.height, padding)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a label rectangle overlaps any other contours (not the one it belongs to)
 */
export function labelOverlapsOtherContours(
  center: Vector2,
  width: number,
  height: number,
  otherContours: Contour[],
  padding: number = 0
): boolean {
  const halfW = (width + padding) / 2;
  const halfH = (height + padding) / 2;

  for (const contour of otherContours) {
    // Check if label center is inside other contour
    if (isPointInContour(center, contour)) {
      return true;
    }

    // Check corners
    const corners = [
      vec2(center.x - halfW, center.y - halfH),
      vec2(center.x + halfW, center.y - halfH),
      vec2(center.x + halfW, center.y + halfH),
      vec2(center.x - halfW, center.y + halfH),
    ];

    for (const corner of corners) {
      if (isPointInContour(corner, contour)) {
        return true;
      }
    }

    // Check if any contour edge crosses the rectangle
    const { points } = contour;
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      if (segmentIntersectsRectangle(p1, p2, center, halfW, halfH)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Test if a label rectangle fits entirely inside a contour without crossing edges
 */
export function isRectangleInContour(
  center: Vector2,
  width: number,
  height: number,
  contour: Contour,
  padding: number = 0
): boolean {
  const halfW = (width + padding) / 2;
  const halfH = (height + padding) / 2;

  // Four corners
  const corners = [
    vec2(center.x - halfW, center.y - halfH),
    vec2(center.x + halfW, center.y - halfH),
    vec2(center.x + halfW, center.y + halfH),
    vec2(center.x - halfW, center.y + halfH),
  ];

  // All corners must be inside the contour
  for (const corner of corners) {
    if (!isPointInContour(corner, contour)) {
      return false;
    }
  }

  // Sample points along edges to catch thin necks
  const edgeSamples = 5;
  for (let i = 0; i < 4; i++) {
    const c1 = corners[i];
    const c2 = corners[(i + 1) % 4];
    for (let j = 1; j < edgeSamples; j++) {
      const t = j / edgeSamples;
      const sample = vec2(
        c1.x + (c2.x - c1.x) * t,
        c1.y + (c2.y - c1.y) * t
      );
      if (!isPointInContour(sample, contour)) {
        return false;
      }
    }
  }

  // Check no contour edges cross the rectangle
  const { points } = contour;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    if (segmentIntersectsRectangle(p1, p2, center, halfW, halfH)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a label rectangle overlaps any hole in a contour
 */
export function rectangleOverlapsHoles(
  center: Vector2,
  width: number,
  height: number,
  holes: Contour[],
  padding: number = 0
): boolean {
  const halfW = (width + padding) / 2;
  const halfH = (height + padding) / 2;

  for (const hole of holes) {
    // Check if rectangle center is inside the hole
    if (isPointInContour(center, hole)) {
      return true;
    }

    // Check corners
    const corners = [
      vec2(center.x - halfW, center.y - halfH),
      vec2(center.x + halfW, center.y - halfH),
      vec2(center.x + halfW, center.y + halfH),
      vec2(center.x - halfW, center.y + halfH),
    ];

    for (const corner of corners) {
      if (isPointInContour(corner, hole)) {
        return true;
      }
    }

    // Check if any hole edge crosses the rectangle
    const { points } = hole;
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      if (segmentIntersectsRectangle(p1, p2, center, halfW, halfH)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Calculate true centroid (area-weighted) of a polygon
 */
export function computeTrueCentroid(points: Vector2[]): Vector2 {
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
 * Generate candidate positions for label placement within a contour
 * Returns positions sorted by distance from centroid (prefer central placement)
 */
export function findCandidatePositions(contour: Contour, gridSize: number): Vector2[] {
  const bounds = contourBoundingBox(contour);
  const centroid = computeTrueCentroid(contour.points);
  const candidates: { pos: Vector2; dist: number }[] = [];

  // Start with the centroid
  candidates.push({ pos: centroid, dist: 0 });

  // Grid search within bounding box
  for (let x = bounds.minX; x <= bounds.maxX; x += gridSize) {
    for (let y = bounds.minY; y <= bounds.maxY; y += gridSize) {
      const pos = vec2(x, y);
      const dx = pos.x - centroid.x;
      const dy = pos.y - centroid.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      candidates.push({ pos, dist });
    }
  }

  // Sort by distance from centroid
  candidates.sort((a, b) => a.dist - b.dist);

  return candidates.map(c => c.pos);
}

/**
 * Find the closest point on the contour to a target point
 */
function findClosestPointOnContour(contour: Contour, target: Vector2): Vector2 {
  let closest = contour.points[0];
  let minDist = Infinity;

  for (const p of contour.points) {
    const dx = p.x - target.x;
    const dy = p.y - target.y;
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      closest = p;
    }
  }

  return closest;
}

/**
 * Find external placement position for a label (outside the contour but nearby)
 * Places label as close as possible to the piece while avoiding overlap.
 */
function findExternalPlacement(
  contour: Contour,
  width: number,
  height: number,
  padding: number
): Vector2 {
  const bounds = contourBoundingBox(contour);
  const centroid = computeTrueCentroid(contour.points);

  const halfW = width / 2;
  const halfH = height / 2;
  const gap = padding;

  // Generate candidate positions at different X/Y locations along edges
  const candidates: Vector2[] = [];

  // Try positions below the piece at different X coordinates
  const xPositions = [centroid.x, bounds.minX + halfW, bounds.maxX - halfW, (bounds.minX + bounds.maxX) / 2];
  const yPositions = [centroid.y, bounds.minY + halfH, bounds.maxY - halfH, (bounds.minY + bounds.maxY) / 2];

  for (const x of xPositions) {
    if (x >= bounds.minX && x <= bounds.maxX) {
      candidates.push(vec2(x, bounds.minY - halfH - gap)); // Below
      candidates.push(vec2(x, bounds.maxY + halfH + gap)); // Above
    }
  }

  for (const y of yPositions) {
    if (y >= bounds.minY && y <= bounds.maxY) {
      candidates.push(vec2(bounds.minX - halfW - gap, y)); // Left
      candidates.push(vec2(bounds.maxX + halfW + gap, y)); // Right
    }
  }

  // Find the candidate that's closest to the actual contour
  let best = candidates[0] || vec2(centroid.x, bounds.minY - halfH - gap);
  let bestDist = Infinity;

  for (const pos of candidates) {
    // Find distance to closest point on contour
    const closestOnContour = findClosestPointOnContour(contour, pos);
    const dx = pos.x - closestOnContour.x;
    const dy = pos.y - closestOnContour.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < bestDist) {
      bestDist = dist;
      best = pos;
    }
  }

  return best;
}

/**
 * Main label placement algorithm for a single contour
 * @param contour The contour to place the label in
 * @param holes Holes within the contour
 * @param labelNumber The number to display
 * @param config Placement configuration
 * @param otherContours Other contours on the same layer to avoid
 * @param placedLabels Already placed labels to avoid
 */
export function findLabelPlacement(
  contour: Contour,
  holes: Contour[],
  labelNumber: number,
  config: LabelPlacementConfig = DEFAULT_LABEL_CONFIG,
  otherContours: Contour[] = [],
  placedLabels: PlacedLabel[] = []
): LabelPlacement {
  // Skip degenerate contours
  if (contour.points.length < 3) {
    const centroid = computeTrueCentroid(contour.points);
    const labelBox = getNumberBoundingBox(labelNumber, config.minimumHeight);
    return {
      position: centroid,
      height: config.minimumHeight,
      width: labelBox.width,
      type: 'external',
    };
  }

  // Try each height from preferred down to minimum
  for (const height of config.heightSteps) {
    if (height < config.minimumHeight) continue;

    const labelBox = getNumberBoundingBox(labelNumber, height);
    const { width } = labelBox;

    // Try to place inside the main contour
    const candidates = findCandidatePositions(contour, config.searchGridSize);

    for (const pos of candidates) {
      // Check if rectangle fits inside contour
      if (!isRectangleInContour(pos, width, height, contour, config.labelPadding)) {
        continue;
      }

      // Check if rectangle overlaps any holes
      if (rectangleOverlapsHoles(pos, width, height, holes, config.labelPadding)) {
        continue;
      }

      // Check if rectangle overlaps other contours
      if (labelOverlapsOtherContours(pos, width, height, otherContours, config.labelPadding)) {
        continue;
      }

      // Check if rectangle overlaps already-placed labels
      if (labelOverlapsPlacedLabels(pos, width, height, placedLabels, config.labelPadding)) {
        continue;
      }

      return {
        position: pos,
        height,
        width,
        type: 'inside',
      };
    }

    // Try placing inside holes (for annular shapes)
    for (const hole of holes) {
      if (hole.points.length < 3) continue;

      const holeCandidates = findCandidatePositions(hole, config.searchGridSize);

      for (const pos of holeCandidates) {
        // Check if rectangle fits inside the hole
        if (!isRectangleInContour(pos, width, height, hole, config.labelPadding)) {
          continue;
        }

        // Check if rectangle overlaps other contours
        if (labelOverlapsOtherContours(pos, width, height, otherContours, config.labelPadding)) {
          continue;
        }

        // Check if rectangle overlaps already-placed labels
        if (labelOverlapsPlacedLabels(pos, width, height, placedLabels, config.labelPadding)) {
          continue;
        }

        return {
          position: pos,
          height,
          width,
          type: 'hole',
        };
      }
    }
  }

  // Last resort: external placement at minimum height
  const minLabelBox = getNumberBoundingBox(labelNumber, config.minimumHeight);
  let externalPos = findExternalPlacement(
    contour,
    minLabelBox.width,
    config.minimumHeight,
    config.labelPadding
  );

  // Check if external position conflicts, try alternatives if needed
  const needsAlternative =
    labelOverlapsOtherContours(externalPos, minLabelBox.width, config.minimumHeight, otherContours, config.labelPadding) ||
    labelOverlapsPlacedLabels(externalPos, minLabelBox.width, config.minimumHeight, placedLabels, config.labelPadding);

  if (needsAlternative) {
    const bounds = contourBoundingBox(contour);
    const centroid = computeTrueCentroid(contour.points);
    const halfW = minLabelBox.width / 2;
    const halfH = config.minimumHeight / 2;
    const gap = config.labelPadding;

    const externalCandidates = [
      // Cardinal directions with small gap
      vec2(centroid.x, bounds.minY - halfH - gap),
      vec2(centroid.x, bounds.maxY + halfH + gap),
      vec2(bounds.minX - halfW - gap, centroid.y),
      vec2(bounds.maxX + halfW + gap, centroid.y),
      // Cardinal directions with slightly larger gap if needed
      vec2(centroid.x, bounds.minY - halfH - gap * 2),
      vec2(centroid.x, bounds.maxY + halfH + gap * 2),
      vec2(bounds.minX - halfW - gap * 2, centroid.y),
      vec2(bounds.maxX + halfW + gap * 2, centroid.y),
      // Corner positions
      vec2(bounds.minX - halfW - gap, bounds.minY - halfH - gap),
      vec2(bounds.maxX + halfW + gap, bounds.minY - halfH - gap),
      vec2(bounds.minX - halfW - gap, bounds.maxY + halfH + gap),
      vec2(bounds.maxX + halfW + gap, bounds.maxY + halfH + gap),
    ];

    for (const candidate of externalCandidates) {
      const conflicts =
        labelOverlapsOtherContours(candidate, minLabelBox.width, config.minimumHeight, otherContours, config.labelPadding) ||
        labelOverlapsPlacedLabels(candidate, minLabelBox.width, config.minimumHeight, placedLabels, config.labelPadding);
      if (!conflicts) {
        externalPos = candidate;
        break;
      }
    }
  }

  return {
    position: externalPos,
    height: config.minimumHeight,
    width: minLabelBox.width,
    type: 'external',
  };
}

/**
 * Find label placements for all contours in a slice
 * This ensures labels don't overlap each other or other contours
 */
export function findSliceLabelPlacements(
  contours: Contour[],
  labelNumber: number,
  config: LabelPlacementConfig = DEFAULT_LABEL_CONFIG
): Map<Contour, LabelPlacement> {
  const placements = new Map<Contour, LabelPlacement>();
  const placedLabels: PlacedLabel[] = [];

  // Separate outer contours and holes
  const outerContours = contours.filter(c => !c.isHole && c.points.length >= 3);
  const allHoles = contours.filter(c => c.isHole);

  for (const contour of outerContours) {
    // Find holes belonging to this contour
    const holes = allHoles.filter(h =>
      h.points.length > 0 && isPointInContour(h.points[0], contour)
    );

    // Other outer contours (for collision checking)
    const otherContours = outerContours.filter(c => c !== contour);

    const placement = findLabelPlacement(
      contour,
      holes,
      labelNumber,
      config,
      otherContours,
      placedLabels
    );

    placements.set(contour, placement);

    // Track this label for future collision checks
    placedLabels.push({
      position: placement.position,
      width: placement.width,
      height: placement.height,
    });
  }

  return placements;
}

/**
 * Check if a label rectangle crosses any other pieces
 */
export function labelCrossesOtherPieces(
  labelCenter: Vector2,
  width: number,
  height: number,
  otherPieces: { outerContour: Vector2[]; centroid: Vector2 }[],
  padding: number = 0
): boolean {
  const halfW = (width + padding) / 2;
  const halfH = (height + padding) / 2;

  for (const piece of otherPieces) {
    // Create a contour for the piece
    const pieceContour: Contour = {
      points: piece.outerContour,
      isHole: false,
      area: 0, // Not needed for point-in-contour test
    };

    // Check if any part of the label rectangle is inside the other piece
    const corners = [
      vec2(labelCenter.x - halfW, labelCenter.y - halfH),
      vec2(labelCenter.x + halfW, labelCenter.y - halfH),
      vec2(labelCenter.x + halfW, labelCenter.y + halfH),
      vec2(labelCenter.x - halfW, labelCenter.y + halfH),
    ];

    for (const corner of corners) {
      if (isPointInContour(corner, pieceContour)) {
        return true;
      }
    }

    // Check if label center is inside other piece
    if (isPointInContour(labelCenter, pieceContour)) {
      return true;
    }

    // Check if any edge of the label rectangle crosses the other piece's boundary
    for (let i = 0; i < piece.outerContour.length; i++) {
      const p1 = piece.outerContour[i];
      const p2 = piece.outerContour[(i + 1) % piece.outerContour.length];
      if (segmentIntersectsRectangle(p1, p2, labelCenter, halfW, halfH)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get the transformed contour and centroid for a placed piece
 */
function getTransformedPiece(placed: PlacedPiece): {
  outerContour: Vector2[];
  holes: Vector2[][];
  centroid: Vector2;
} {
  const { piece, x, y, rotation } = placed;

  // First rotate around piece centroid
  const rotated = rotatePiece(piece, rotation, piece.centroid);

  // Calculate translation to place at (x, y)
  const dx = x - rotated.boundingBox.minX;
  const dy = y - rotated.boundingBox.minY;

  return {
    outerContour: rotated.outerContour.map(p => vec2(p.x + dx, p.y + dy)),
    holes: rotated.holes.map(hole => hole.map(p => vec2(p.x + dx, p.y + dy))),
    centroid: vec2(rotated.centroid.x + dx, rotated.centroid.y + dy),
  };
}

/**
 * Find label placement for a packed piece, considering other pieces and already-placed labels
 */
export function findPackedLabelPlacement(
  placed: PlacedPiece,
  otherPieces: PlacedPiece[],
  config: LabelPlacementConfig = DEFAULT_LABEL_CONFIG,
  placedLabels: PlacedLabel[] = []
): LabelPlacement {
  const transformed = getTransformedPiece(placed);
  const labelNumber = placed.piece.layerIndex + 1;

  // Create contour from transformed outer contour
  const contour: Contour = {
    points: transformed.outerContour,
    isHole: false,
    area: placed.piece.area,
  };

  // Create hole contours
  const holes: Contour[] = transformed.holes.map(holePoints => ({
    points: holePoints,
    isHole: true,
    area: 0,
  }));

  // Get transformed other pieces for collision checking
  const transformedOtherPieces = otherPieces.map(p => getTransformedPiece(p));

  // Try each height from preferred down to minimum
  for (const height of config.heightSteps) {
    if (height < config.minimumHeight) continue;

    const labelBox = getNumberBoundingBox(labelNumber, height);
    const { width } = labelBox;

    // Try to place inside the main contour
    const candidates = findCandidatePositions(contour, config.searchGridSize);

    for (const pos of candidates) {
      // Check if rectangle fits inside contour
      if (!isRectangleInContour(pos, width, height, contour, config.labelPadding)) {
        continue;
      }

      // Check if rectangle overlaps any holes
      if (rectangleOverlapsHoles(pos, width, height, holes, config.labelPadding)) {
        continue;
      }

      // Check if rectangle crosses other pieces
      if (labelCrossesOtherPieces(pos, width, height, transformedOtherPieces, config.labelPadding)) {
        continue;
      }

      // Check if rectangle overlaps already-placed labels
      if (labelOverlapsPlacedLabels(pos, width, height, placedLabels, config.labelPadding)) {
        continue;
      }

      return {
        position: pos,
        height,
        width,
        type: 'inside',
      };
    }

    // Try placing inside holes (for annular shapes)
    for (const hole of holes) {
      if (hole.points.length < 3) continue;

      const holeCandidates = findCandidatePositions(hole, config.searchGridSize);

      for (const pos of holeCandidates) {
        // Check if rectangle fits inside the hole
        if (!isRectangleInContour(pos, width, height, hole, config.labelPadding)) {
          continue;
        }

        // Check if rectangle crosses other pieces
        if (labelCrossesOtherPieces(pos, width, height, transformedOtherPieces, config.labelPadding)) {
          continue;
        }

        // Check if rectangle overlaps already-placed labels
        if (labelOverlapsPlacedLabels(pos, width, height, placedLabels, config.labelPadding)) {
          continue;
        }

        return {
          position: pos,
          height,
          width,
          type: 'hole',
        };
      }
    }
  }

  // Last resort: external placement at minimum height
  const minLabelBox = getNumberBoundingBox(labelNumber, config.minimumHeight);
  let externalPos = findExternalPlacement(
    contour,
    minLabelBox.width,
    config.minimumHeight,
    config.labelPadding
  );

  // Check if external position has conflicts, try alternatives if needed
  const hasConflict = () =>
    labelCrossesOtherPieces(externalPos, minLabelBox.width, config.minimumHeight, transformedOtherPieces, config.labelPadding) ||
    labelOverlapsPlacedLabels(externalPos, minLabelBox.width, config.minimumHeight, placedLabels, config.labelPadding);

  if (hasConflict()) {
    // Try multiple external positions with minimal offset
    const bounds = contourBoundingBox(contour);
    const centroid = computeTrueCentroid(contour.points);
    const halfW = minLabelBox.width / 2;
    const halfH = config.minimumHeight / 2;
    const gap = config.labelPadding;

    const externalCandidates = [
      // Cardinal directions with small gap
      vec2(centroid.x, bounds.minY - halfH - gap),
      vec2(centroid.x, bounds.maxY + halfH + gap),
      vec2(bounds.minX - halfW - gap, centroid.y),
      vec2(bounds.maxX + halfW + gap, centroid.y),
      // Cardinal directions with slightly larger gap if needed
      vec2(centroid.x, bounds.minY - halfH - gap * 2),
      vec2(centroid.x, bounds.maxY + halfH + gap * 2),
      vec2(bounds.minX - halfW - gap * 2, centroid.y),
      vec2(bounds.maxX + halfW + gap * 2, centroid.y),
      // Corner positions
      vec2(bounds.minX - halfW - gap, bounds.minY - halfH - gap),
      vec2(bounds.maxX + halfW + gap, bounds.minY - halfH - gap),
      vec2(bounds.minX - halfW - gap, bounds.maxY + halfH + gap),
      vec2(bounds.maxX + halfW + gap, bounds.maxY + halfH + gap),
    ];

    for (const candidate of externalCandidates) {
      const candidateConflicts =
        labelCrossesOtherPieces(candidate, minLabelBox.width, config.minimumHeight, transformedOtherPieces, config.labelPadding) ||
        labelOverlapsPlacedLabels(candidate, minLabelBox.width, config.minimumHeight, placedLabels, config.labelPadding);
      if (!candidateConflicts) {
        externalPos = candidate;
        break;
      }
    }
  }

  return {
    position: externalPos,
    height: config.minimumHeight,
    width: minLabelBox.width,
    type: 'external',
  };
}
