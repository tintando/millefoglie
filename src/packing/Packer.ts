import { Vector2 } from '../types/geometry';
import { PackablePiece, PlacedPiece, PackedSheet, PackingConfig, PackingResult, BoundingBox2D } from './types';
import { rotatePiece, simplifyContour } from './PieceExtractor';
import { createGrid, insertPiece, queryNearby, SpatialGrid } from './SpatialGrid';

// Grid cell size - balances between query efficiency and memory usage
const GRID_CELL_SIZE = 20; // mm

// Tolerance for contour simplification (mm) - higher = fewer vertices = faster but less precise
const SIMPLIFY_TOLERANCE = 1.0;

/**
 * Bounding circle data for fast distance pre-checks
 */
interface BoundingCircle {
  cx: number;  // Center X
  cy: number;  // Center Y
  r: number;   // Radius
}

/**
 * Pre-computed rotation data for a piece at a specific angle
 */
interface RotatedPieceData {
  rotation: number;
  outerContour: Vector2[];       // Original contour for final placement
  simplifiedContour: Vector2[];  // Simplified contour for collision detection
  boundingBox: BoundingBox2D;
  boundingCircle: BoundingCircle; // For fast distance pre-check
  width: number;
  height: number;
}

/**
 * Cached data for a placed piece to avoid redundant calculations
 */
interface PlacedPieceCache {
  boundingBox: BoundingBox2D;
  boundingCircle: BoundingCircle;
  contour: Vector2[];
}

/**
 * Compute bounding circle for a contour (smallest enclosing circle approximation)
 * Uses the bounding box center and maximum distance to any vertex
 */
function computeBoundingCircle(contour: Vector2[], bb: BoundingBox2D): BoundingCircle {
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;

  // Find maximum distance from center to any vertex
  let maxDistSq = 0;
  for (const p of contour) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const distSq = dx * dx + dy * dy;
    if (distSq > maxDistSq) maxDistSq = distSq;
  }

  return { cx, cy, r: Math.sqrt(maxDistSq) };
}

/**
 * Pre-compute all rotation variants for a piece
 */
function precomputeRotations(piece: PackablePiece, rotationSteps: number): RotatedPieceData[] {
  const rotations: RotatedPieceData[] = [];

  for (let step = 0; step < rotationSteps; step++) {
    const rotation = (step / rotationSteps) * Math.PI * 2;
    const rotated = rotatePiece(piece, rotation, piece.centroid);
    const width = rotated.boundingBox.maxX - rotated.boundingBox.minX;
    const height = rotated.boundingBox.maxY - rotated.boundingBox.minY;

    // Simplify contour for faster collision detection
    const simplifiedContour = simplifyContour(rotated.outerContour, SIMPLIFY_TOLERANCE);

    // Compute bounding circle for fast distance pre-check
    const boundingCircle = computeBoundingCircle(simplifiedContour, rotated.boundingBox);

    rotations.push({
      rotation,
      outerContour: rotated.outerContour,
      simplifiedContour,
      boundingBox: rotated.boundingBox,
      boundingCircle,
      width,
      height,
    });
  }

  return rotations;
}

/**
 * Check if two axis-aligned bounding boxes overlap (or are closer than spacing).
 * Uses <= to correctly handle pieces placed exactly at spacing distance.
 */
function aabbOverlap(a: BoundingBox2D, b: BoundingBox2D, spacing: number): boolean {
  // Use small epsilon to handle floating point precision issues
  const eps = 1e-6;
  return !(
    a.maxX + spacing <= b.minX + eps ||
    b.maxX + spacing <= a.minX + eps ||
    a.maxY + spacing <= b.minY + eps ||
    b.maxY + spacing <= a.minY + eps
  );
}

/**
 * Cross product of vectors (p1-p0) and (p2-p0)
 */
function cross(p0: Vector2, p1: Vector2, p2: Vector2): number {
  return (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
}

/**
 * Check if two line segments intersect
 */
function segmentsIntersect(a1: Vector2, a2: Vector2, b1: Vector2, b2: Vector2): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

/**
 * Check if a point is inside a polygon using ray casting
 */
function pointInPolygon(point: Vector2, polygon: Vector2[]): boolean {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Check if two polygons overlap
 */
function polygonsOverlap(poly1: Vector2[], poly2: Vector2[]): boolean {
  // Check if any point of poly1 is inside poly2
  for (const p of poly1) {
    if (pointInPolygon(p, poly2)) return true;
  }

  // Check if any point of poly2 is inside poly1
  for (const p of poly2) {
    if (pointInPolygon(p, poly1)) return true;
  }

  // Check if any edges intersect
  for (let i = 0; i < poly1.length; i++) {
    const a1 = poly1[i];
    const a2 = poly1[(i + 1) % poly1.length];

    for (let j = 0; j < poly2.length; j++) {
      const b1 = poly2[j];
      const b2 = poly2[(j + 1) % poly2.length];

      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }

  return false;
}

/**
 * Translate a pre-computed contour to a position
 * Optimized to reduce object allocations by reusing array
 */
function translateContour(contour: Vector2[], rotatedBB: BoundingBox2D, x: number, y: number): Vector2[] {
  const dx = x - rotatedBB.minX;
  const dy = y - rotatedBB.minY;
  const result = new Array<Vector2>(contour.length);
  for (let i = 0; i < contour.length; i++) {
    result[i] = { x: contour[i].x + dx, y: contour[i].y + dy };
  }
  return result;
}

/**
 * Get transformed bounding box for a piece at position (using pre-computed data)
 */
function getTransformedBoundingBox(rotatedData: RotatedPieceData, x: number, y: number): BoundingBox2D {
  return {
    minX: x,
    maxX: x + rotatedData.width,
    minY: y,
    maxY: y + rotatedData.height,
  };
}

/**
 * Get transformed bounding circle for a piece at position
 */
function getTransformedBoundingCircle(rotatedData: RotatedPieceData, x: number, y: number): BoundingCircle {
  const dx = x - rotatedData.boundingBox.minX;
  const dy = y - rotatedData.boundingBox.minY;
  return {
    cx: rotatedData.boundingCircle.cx + dx,
    cy: rotatedData.boundingCircle.cy + dy,
    r: rotatedData.boundingCircle.r,
  };
}

/**
 * Check if two bounding circles are close enough to require polygon check
 * Returns true if circles overlap or are within threshold distance
 */
function circlesMayOverlap(c1: BoundingCircle, c2: BoundingCircle, threshold: number): boolean {
  const dx = c1.cx - c2.cx;
  const dy = c1.cy - c2.cy;
  const distSq = dx * dx + dy * dy;
  const minDist = c1.r + c2.r + threshold;
  return distSq < minDist * minDist;
}

/**
 * Check if minimum distance between two polygons is less than threshold.
 * Optimized with inlined distance calculation for tight loop performance.
 * Returns true if distance < threshold (i.e., too close).
 */
function polygonsTooClose(poly1: Vector2[], poly2: Vector2[], threshold: number): boolean {
  const thresholdSq = threshold * threshold;
  const n1 = poly1.length;
  const n2 = poly2.length;

  // Check distance from each vertex of poly1 to each edge of poly2
  for (let pi = 0; pi < n1; pi++) {
    const px = poly1[pi].x;
    const py = poly1[pi].y;

    for (let i = 0; i < n2; i++) {
      const ax = poly2[i].x;
      const ay = poly2[i].y;
      const ni = i + 1 < n2 ? i + 1 : 0;
      const bx = poly2[ni].x;
      const by = poly2[ni].y;

      // Inline point-to-segment distance squared
      const abx = bx - ax;
      const aby = by - ay;
      const apx = px - ax;
      const apy = py - ay;

      const abLenSq = abx * abx + aby * aby;
      let distSq: number;

      if (abLenSq === 0) {
        distSq = apx * apx + apy * apy;
      } else {
        let t = (apx * abx + apy * aby) / abLenSq;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;

        const closestX = ax + t * abx;
        const closestY = ay + t * aby;
        const dx = px - closestX;
        const dy = py - closestY;
        distSq = dx * dx + dy * dy;
      }

      if (distSq < thresholdSq) {
        return true;
      }
    }
  }

  // Check distance from each vertex of poly2 to each edge of poly1
  for (let pi = 0; pi < n2; pi++) {
    const px = poly2[pi].x;
    const py = poly2[pi].y;

    for (let i = 0; i < n1; i++) {
      const ax = poly1[i].x;
      const ay = poly1[i].y;
      const ni = i + 1 < n1 ? i + 1 : 0;
      const bx = poly1[ni].x;
      const by = poly1[ni].y;

      // Inline point-to-segment distance squared
      const abx = bx - ax;
      const aby = by - ay;
      const apx = px - ax;
      const apy = py - ay;

      const abLenSq = abx * abx + aby * aby;
      let distSq: number;

      if (abLenSq === 0) {
        distSq = apx * apx + apy * apy;
      } else {
        let t = (apx * abx + apy * aby) / abLenSq;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;

        const closestX = ax + t * abx;
        const closestY = ay + t * aby;
        const dx = px - closestX;
        const dy = py - closestY;
        distSq = dx * dx + dy * dy;
      }

      if (distSq < thresholdSq) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a piece can be placed at a position without overlapping other pieces.
 * Uses spatial grid for efficient neighbor lookup and cached data for placed pieces.
 */
function canPlace(
  rotatedData: RotatedPieceData,
  x: number,
  y: number,
  grid: SpatialGrid,
  placedCache: Map<PlacedPiece, PlacedPieceCache>,
  config: PackingConfig,
  effectiveSpacing: number
): boolean {
  const candidateBB = getTransformedBoundingBox(rotatedData, x, y);

  // Check paper bounds
  const usableWidth = config.paperWidth - 2 * config.margin;
  const usableHeight = config.paperHeight - 2 * config.margin;

  if (candidateBB.maxX > usableWidth || candidateBB.maxY > usableHeight) {
    return false;
  }

  // Query nearby pieces using effective spacing to catch all potential conflicts
  const nearbyPieces = queryNearby(grid, candidateBB, effectiveSpacing);

  // In fast mode, we use expanded AABB check only (skip polygon checks)
  // Use effectiveSpacing to ensure proper gap for labels
  if (config.fastMode) {
    for (const placed of nearbyPieces) {
      const cache = placedCache.get(placed);
      if (!cache) continue;

      // Check if AABBs overlap with effective spacing (includes label room)
      if (aabbOverlap(candidateBB, cache.boundingBox, effectiveSpacing)) {
        return false;
      }
    }
    return true;
  }

  // Precise mode: do full polygon collision check using simplified contours
  let candidateContour: Vector2[] | null = null;
  let candidateCircle: BoundingCircle | null = null;

  for (const placed of nearbyPieces) {
    const cache = placedCache.get(placed);
    if (!cache) continue;

    // Quick AABB check with effective spacing (includes label room)
    if (aabbOverlap(candidateBB, cache.boundingBox, effectiveSpacing)) {
      // Lazy compute candidate bounding circle
      if (!candidateCircle) {
        candidateCircle = getTransformedBoundingCircle(rotatedData, x, y);
      }

      // Fast bounding circle check - skip expensive polygon checks if circles are far apart
      if (!circlesMayOverlap(candidateCircle, cache.boundingCircle, effectiveSpacing)) {
        continue; // Circles don't overlap, skip polygon checks
      }

      // Lazy compute candidate contour only when needed (use simplified for speed)
      if (!candidateContour) {
        candidateContour = translateContour(rotatedData.simplifiedContour, rotatedData.boundingBox, x, y);
      }

      // Check polygon overlap using simplified contours
      if (polygonsOverlap(candidateContour, cache.contour)) {
        return false;
      }

      // Check minimum distance between contours using effective spacing
      // This ensures both the required pieceSpacing AND label room are maintained
      // Using optimized check with squared distances and early exit
      if (polygonsTooClose(candidateContour, cache.contour, effectiveSpacing)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Pre-computed position sets from placed pieces.
 * Computing these once and reusing across rotations saves significant time.
 */
interface PositionSets {
  sortedX: number[];
  sortedY: number[];
}

/**
 * Compute the sets of candidate X and Y positions from placed pieces.
 * These only depend on placed pieces, not on the candidate piece's rotation.
 */
function computePositionSets(
  placedCache: Map<PlacedPiece, PlacedPieceCache>,
  spacing: number
): PositionSets {
  // Collect all unique X positions
  const xSet = new Set<number>();
  xSet.add(0);

  // Collect all unique Y positions
  const ySet = new Set<number>();
  ySet.add(0);

  // Add positions derived from placed pieces
  for (const cache of placedCache.values()) {
    const bb = cache.boundingBox;
    xSet.add(bb.maxX + spacing);
    ySet.add(bb.maxY + spacing);
  }

  return {
    sortedX: Array.from(xSet).sort((a, b) => a - b),
    sortedY: Array.from(ySet).sort((a, b) => a - b),
  };
}

/**
 * Generate placement candidates from pre-computed position sets.
 * Filters positions based on piece dimensions.
 */
function generateCandidatesFromSets(
  positionSets: PositionSets,
  pieceWidth: number,
  pieceHeight: number,
  usableWidth: number,
  usableHeight: number
): { x: number; y: number }[] {
  const candidates: { x: number; y: number }[] = [];
  const maxX = usableWidth - pieceWidth;
  const maxY = usableHeight - pieceHeight;

  for (const y of positionSets.sortedY) {
    if (y > maxY) break;
    for (const x of positionSets.sortedX) {
      if (x > maxX) break;
      candidates.push({ x, y });
    }
  }

  return candidates;
}

/**
 * Calculate effective spacing that includes a small buffer for external labels.
 * The label placement algorithm handles most overlap avoidance, so we only
 * need a small additional margin.
 */
function getEffectiveSpacing(config: PackingConfig): number {
  let spacing = config.pieceSpacing;

  // Add small extra spacing for external labels when label cuts are enabled
  if (config.showLabelCut) {
    // Just add a small buffer - the label placement algorithm handles collision avoidance
    const labelBuffer = 1.0; // 1mm extra buffer for labels
    spacing += labelBuffer;
  }

  return spacing;
}

/**
 * Find the best position for a piece using bottom-left fill algorithm.
 * Uses pre-computed rotations and spatial grid for efficient collision detection.
 */
function findBestPosition(
  rotations: RotatedPieceData[],
  grid: SpatialGrid,
  placedCache: Map<PlacedPiece, PlacedPieceCache>,
  config: PackingConfig
): { x: number; y: number; rotation: number } | null {
  const usableWidth = config.paperWidth - 2 * config.margin;
  const usableHeight = config.paperHeight - 2 * config.margin;

  // Use effective spacing that accounts for labels
  const effectiveSpacing = getEffectiveSpacing(config);

  // Compute position sets once (shared across all rotations)
  const positionSets = computePositionSets(placedCache, effectiveSpacing);

  let bestPosition: { x: number; y: number; rotation: number } | null = null;
  let bestScore = Infinity;

  // Try each pre-computed rotation
  for (const rotatedData of rotations) {
    // Skip if piece doesn't fit at all
    if (rotatedData.width > usableWidth || rotatedData.height > usableHeight) {
      continue;
    }

    // Generate placement candidates from pre-computed position sets
    const candidates = generateCandidatesFromSets(
      positionSets,
      rotatedData.width,
      rotatedData.height,
      usableWidth,
      usableHeight
    );

    // Candidates are already sorted by Y then X
    // Test candidates in order
    for (const { x, y } of candidates) {
      // Early exit: if this candidate's score is worse than best, skip remaining
      const score = y * 1000 + x;
      if (score >= bestScore) {
        break; // Candidates are sorted, so all remaining are worse
      }

      if (canPlace(rotatedData, x, y, grid, placedCache, config, effectiveSpacing)) {
        bestScore = score;
        bestPosition = { x, y, rotation: rotatedData.rotation };
        break; // Found best position for this rotation, try next rotation
      }
    }
  }

  return bestPosition;
}

/**
 * Build cache for a placed piece (using pre-computed rotation data)
 * Uses simplified contour for faster collision detection
 */
function buildPlacedPieceCache(placed: PlacedPiece, rotatedData: RotatedPieceData): PlacedPieceCache {
  return {
    boundingBox: getTransformedBoundingBox(rotatedData, placed.x, placed.y),
    boundingCircle: getTransformedBoundingCircle(rotatedData, placed.x, placed.y),
    contour: translateContour(rotatedData.simplifiedContour, rotatedData.boundingBox, placed.x, placed.y),
  };
}

/**
 * Pack pieces onto sheets using bottom-left fill with rotation.
 * Optimized with spatial grid indexing, pre-computed rotations, and caching.
 * Supports progress callback for UI feedback.
 */
export function packPiecesWithProgress(
  pieces: PackablePiece[],
  config: PackingConfig,
  onProgress?: (current: number, total: number, sheets: number) => void
): PackingResult {
  // Sort pieces by area (largest first)
  const sortedPieces = [...pieces].sort((a, b) => b.area - a.area);

  const sheets: PackedSheet[] = [];
  const unplacedPieces: PackablePiece[] = [];

  const usableWidth = config.paperWidth - 2 * config.margin;
  const usableHeight = config.paperHeight - 2 * config.margin;

  // Initialize first sheet with spatial grid and cache
  let currentSheet: PackedSheet = {
    index: 0,
    pieces: [],
    utilization: 0,
  };
  let currentGrid = createGrid(usableWidth, usableHeight, GRID_CELL_SIZE);
  let currentCache = new Map<PlacedPiece, PlacedPieceCache>();

  sheets.push(currentSheet);

  const total = sortedPieces.length;

  for (let i = 0; i < sortedPieces.length; i++) {
    const piece = sortedPieces[i];

    // Report progress
    if (onProgress) {
      onProgress(i, total, sheets.length);
    }

    // Pre-compute all rotations for this piece (done once per piece)
    const rotations = precomputeRotations(piece, config.rotationSteps);

    // Try to place on current sheet
    let position = findBestPosition(rotations, currentGrid, currentCache, config);

    if (!position) {
      // Start a new sheet
      currentSheet = {
        index: sheets.length,
        pieces: [],
        utilization: 0,
      };
      currentGrid = createGrid(usableWidth, usableHeight, GRID_CELL_SIZE);
      currentCache = new Map<PlacedPiece, PlacedPieceCache>();

      sheets.push(currentSheet);

      position = findBestPosition(rotations, currentGrid, currentCache, config);
    }

    if (position) {
      const placedPiece: PlacedPiece = {
        piece,
        x: position.x,
        y: position.y,
        rotation: position.rotation,
      };

      currentSheet.pieces.push(placedPiece);

      // Find the matching rotation data for cache building
      const rotatedData = rotations.find(r => r.rotation === position!.rotation)!;

      // Build cache for the placed piece and add to spatial grid
      const cache = buildPlacedPieceCache(placedPiece, rotatedData);
      currentCache.set(placedPiece, cache);
      insertPiece(currentGrid, placedPiece, cache.boundingBox);
    } else {
      // Piece is too large for paper
      unplacedPieces.push(piece);
    }
  }

  // Report completion
  if (onProgress) {
    onProgress(total, total, sheets.length);
  }

  // Calculate utilization for each sheet
  const usableArea = usableWidth * usableHeight;

  for (const sheet of sheets) {
    let totalPieceArea = 0;
    for (const placed of sheet.pieces) {
      totalPieceArea += placed.piece.area;
    }
    sheet.utilization = totalPieceArea / usableArea;
  }

  // Remove empty sheets
  const nonEmptySheets = sheets.filter(s => s.pieces.length > 0);

  return {
    sheets: nonEmptySheets,
    totalPieces: pieces.length - unplacedPieces.length,
    unplacedPieces,
  };
}

/**
 * Pack pieces onto sheets using bottom-left fill with rotation.
 * Wrapper for packPiecesWithProgress without progress callback.
 */
export function packPieces(pieces: PackablePiece[], config: PackingConfig): PackingResult {
  return packPiecesWithProgress(pieces, config);
}

/**
 * Calculate the total bounding box of all placed pieces on a sheet
 */
export function getSheetBoundingBox(sheet: PackedSheet): BoundingBox2D {
  if (sheet.pieces.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const placed of sheet.pieces) {
    const rotated = rotatePiece(placed.piece, placed.rotation, placed.piece.centroid);

    const bb = {
      minX: placed.x,
      maxX: placed.x + (rotated.boundingBox.maxX - rotated.boundingBox.minX),
      minY: placed.y,
      maxY: placed.y + (rotated.boundingBox.maxY - rotated.boundingBox.minY),
    };

    minX = Math.min(minX, bb.minX);
    maxX = Math.max(maxX, bb.maxX);
    minY = Math.min(minY, bb.minY);
    maxY = Math.max(maxY, bb.maxY);
  }

  return { minX, maxX, minY, maxY };
}
