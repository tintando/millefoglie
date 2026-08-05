import { Vector2, vec2, vec2Distance, vec2Equal } from '../types/geometry';
import { Contour, computeContourArea, isPointInContour } from '../types/slice';
import { IntersectionSegment } from './PlaneIntersection';

/**
 * Configuration for contour building.
 */
export interface ContourBuilderConfig {
  /** Maximum gap to close between segment endpoints (mm) */
  maxGap: number;
  /** Minimum number of points for a valid contour */
  minPoints: number;
  /** Whether to simplify contours by removing collinear points */
  simplify: boolean;
  /** Simplification tolerance (mm) */
  simplifyTolerance: number;
}

const DEFAULT_CONFIG: ContourBuilderConfig = {
  maxGap: 2.0, // OrcaSlicer uses 2mm for gap closing
  minPoints: 3,
  simplify: true,
  simplifyTolerance: 0.01,
};

/**
 * Open polyline being built during chaining.
 */
interface OpenPolyline {
  points: Vector2[];
  startVertexId: number;
  startEdgeId: number;
  endVertexId: number;
  endEdgeId: number;
  consumed: boolean;
  length: number;
}

/**
 * Raw polygon (just points, no hole classification yet).
 */
interface RawPolygon {
  points: Vector2[];
  area: number;
}

/**
 * ExPolygon structure matching OrcaSlicer - outer contour with holes.
 */
export interface ExPolygon {
  contour: Contour;  // Outer boundary (CCW, positive area)
  holes: Contour[];  // Inner voids (CW, negative area)
}

/**
 * Build closed contours from intersection segments.
 *
 * Algorithm closely following OrcaSlicer's approach:
 * 1. Chain segments by edge/vertex connectivity to form raw loops (make_loops)
 * 2. Separate loops by area sign: positive = outer contour, negative = hole
 * 3. Assign holes to parent contours by containment (make_expolygons_simple)
 * 4. Return flat list of contours with isHole flag set appropriately
 */
export function buildContours(
  segments: IntersectionSegment[],
  config: Partial<ContourBuilderConfig> = {}
): Contour[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (segments.length === 0) {
    return [];
  }

  // Phase 1: Build raw loops (OrcaSlicer's make_loops)
  const rawLoops = makeLoops(segments, cfg.maxGap);

  // Phase 2: Convert to ExPolygons (OrcaSlicer's make_expolygons_simple)
  const exPolygons = makeExPolygonsSimple(rawLoops);

  // Phase 3: Flatten to contour list with proper isHole flags
  const contours: Contour[] = [];

  for (const exPoly of exPolygons) {
    // Add outer contour
    let outerPoints = exPoly.contour.points;
    if (cfg.simplify) {
      outerPoints = simplifyContour(outerPoints, cfg.simplifyTolerance);
    }
    if (outerPoints.length >= cfg.minPoints) {
      const area = computeContourArea(outerPoints);
      contours.push({
        points: outerPoints,
        isHole: false,
        area: Math.abs(area),
      });
    }

    // Add holes
    for (const hole of exPoly.holes) {
      let holePoints = hole.points;
      if (cfg.simplify) {
        holePoints = simplifyContour(holePoints, cfg.simplifyTolerance);
      }
      if (holePoints.length >= cfg.minPoints) {
        const area = computeContourArea(holePoints);
        contours.push({
          points: holePoints,
          isHole: true,
          area: Math.abs(area),
        });
      }
    }
  }

  return contours;
}

/**
 * Build raw polygon loops from intersection segments.
 * This is OrcaSlicer's make_loops() function.
 */
function makeLoops(segments: IntersectionSegment[], maxGap: number): RawPolygon[] {
  const loops: RawPolygon[] = [];
  const openPolylines: OpenPolyline[] = [];

  // Phase 1: Chain by exact connectivity
  chainByConnectivity(segments, loops, openPolylines);

  // Phase 2: Connect open polylines by exact endpoint match
  chainOpenPolylinesExact(openPolylines, loops, false);
  chainOpenPolylinesExact(openPolylines, loops, true);

  // Phase 3: Close gaps (OrcaSlicer's chain_open_polylines_close_gaps)
  chainOpenPolylinesCloseGaps(openPolylines, loops, maxGap, false);
  chainOpenPolylinesCloseGaps(openPolylines, loops, maxGap, true);

  return loops;
}

/**
 * Convert raw polygon loops to ExPolygons by assigning holes to parent contours.
 * This is OrcaSlicer's make_expolygons_simple() function.
 *
 * Key insight from OrcaSlicer:
 * - area >= 0 → outer contour (CCW winding)
 * - area < 0 → hole (CW winding)
 * - Each hole is assigned to the smallest outer contour that contains it
 */
function makeExPolygonsSimple(loops: RawPolygon[]): ExPolygon[] {
  const exPolygons: ExPolygon[] = [];
  const holes: RawPolygon[] = [];

  // Separate outer contours from holes by area sign
  for (const loop of loops) {
    if (loop.area >= 0) {
      // Positive area = outer contour (CCW)
      exPolygons.push({
        contour: {
          points: loop.points,
          isHole: false,
          area: loop.area,
        },
        holes: [],
      });
    } else {
      // Negative area = hole (CW)
      holes.push(loop);
    }
  }

  // Assign each hole to the smallest outer contour that contains it
  for (const hole of holes) {
    if (hole.points.length === 0) continue;

    // Use first point of hole for containment test (OrcaSlicer approach)
    const testPoint = hole.points[0];

    let bestIdx = -1;
    let bestArea = Infinity;

    for (let i = 0; i < exPolygons.length; i++) {
      const exPoly = exPolygons[i];
      // Check if test point is inside this contour
      if (isPointInContour(testPoint, exPoly.contour)) {
        // Find the smallest containing contour
        if (exPoly.contour.area < bestArea) {
          bestArea = exPoly.contour.area;
          bestIdx = i;
        }
      }
    }

    if (bestIdx !== -1) {
      exPolygons[bestIdx].holes.push({
        points: hole.points,
        isHole: true,
        area: Math.abs(hole.area),
      });
    }
    // If no containing contour found, ignore the hole (OrcaSlicer behavior)
  }

  return exPolygons;
}

/**
 * Chain segments using exact vertex/edge connectivity.
 * Based on OrcaSlicer's chain_lines_by_triangle_connectivity().
 */
function chainByConnectivity(
  segments: IntersectionSegment[],
  loops: RawPolygon[],
  openPolylines: OpenPolyline[]
): void {
  // Build lookup maps for finding connected segments
  const byEdgeA = new Map<number, IntersectionSegment[]>();
  const byVertexA = new Map<number, IntersectionSegment[]>();

  for (const seg of segments) {
    if (seg.a.edgeId !== -1) {
      const list = byEdgeA.get(seg.a.edgeId) || [];
      list.push(seg);
      byEdgeA.set(seg.a.edgeId, list);
    }
    if (seg.a.vertexId !== -1) {
      const list = byVertexA.get(seg.a.vertexId) || [];
      list.push(seg);
      byVertexA.set(seg.a.vertexId, list);
    }
  }

  const used = new Set<IntersectionSegment>();

  for (const firstSeg of segments) {
    if (used.has(firstSeg)) continue;

    used.add(firstSeg);
    const points: Vector2[] = [firstSeg.a.point];
    let current = firstSeg;

    // Chain forward
    while (true) {
      let next: IntersectionSegment | null = null;

      // Try to find next segment by edge
      if (current.b.edgeId !== -1) {
        const candidates = byEdgeA.get(current.b.edgeId) || [];
        for (const cand of candidates) {
          if (!used.has(cand)) {
            next = cand;
            break;
          }
        }
      }

      // Try to find by vertex
      if (!next && current.b.vertexId !== -1) {
        const candidates = byVertexA.get(current.b.vertexId) || [];
        for (const cand of candidates) {
          if (!used.has(cand)) {
            next = cand;
            break;
          }
        }
      }

      if (!next) {
        // Check if loop is closed
        const closed =
          (firstSeg.a.edgeId !== -1 && firstSeg.a.edgeId === current.b.edgeId) ||
          (firstSeg.a.vertexId !== -1 && firstSeg.a.vertexId === current.b.vertexId);

        if (closed) {
          // Closed loop - compute area to determine winding
          const area = computeContourArea(points);
          loops.push({ points, area });
        } else {
          // Open polyline
          points.push(current.b.point);
          openPolylines.push({
            points,
            startVertexId: firstSeg.a.vertexId,
            startEdgeId: firstSeg.a.edgeId,
            endVertexId: current.b.vertexId,
            endEdgeId: current.b.edgeId,
            consumed: false,
            length: polylineLength(points),
          });
        }
        break;
      }

      points.push(next.a.point);
      used.add(next);
      current = next;
    }
  }
}

/**
 * Connect open polylines by exact endpoint matching.
 * Based on OrcaSlicer's chain_open_polylines_exact().
 */
function chainOpenPolylinesExact(
  openPolylines: OpenPolyline[],
  loops: RawPolygon[],
  tryReversed: boolean
): void {
  interface EndpointRef {
    polyline: OpenPolyline;
    isStart: boolean;
  }

  const byEdge = new Map<number, EndpointRef[]>();
  const byVertex = new Map<number, EndpointRef[]>();

  const addEndpoint = (pl: OpenPolyline, isStart: boolean) => {
    const vertexId = isStart ? pl.startVertexId : pl.endVertexId;
    const edgeId = isStart ? pl.startEdgeId : pl.endEdgeId;

    if (edgeId !== -1) {
      const list = byEdge.get(edgeId) || [];
      list.push({ polyline: pl, isStart });
      byEdge.set(edgeId, list);
    }
    if (vertexId !== -1) {
      const list = byVertex.get(vertexId) || [];
      list.push({ polyline: pl, isStart });
      byVertex.set(vertexId, list);
    }
  };

  for (const pl of openPolylines) {
    if (!pl.consumed) {
      addEndpoint(pl, true);
      if (tryReversed) addEndpoint(pl, false);
    }
  }

  // Sort by length (longer first) - OrcaSlicer approach
  const sorted = openPolylines
    .filter(pl => !pl.consumed)
    .sort((a, b) => b.length - a.length);

  for (const pl of sorted) {
    if (pl.consumed) continue;
    pl.consumed = true;

    while (true) {
      let nextRef: EndpointRef | null = null;

      if (pl.endEdgeId !== -1) {
        const candidates = byEdge.get(pl.endEdgeId) || [];
        for (const ref of candidates) {
          if (!ref.polyline.consumed) {
            nextRef = ref;
            break;
          }
        }
      }

      if (!nextRef && pl.endVertexId !== -1) {
        const candidates = byVertex.get(pl.endVertexId) || [];
        for (const ref of candidates) {
          if (!ref.polyline.consumed) {
            nextRef = ref;
            break;
          }
        }
      }

      if (!nextRef) {
        // Check if closed
        if (
          (pl.startEdgeId !== -1 && pl.startEdgeId === pl.endEdgeId) ||
          (pl.startVertexId !== -1 && pl.startVertexId === pl.endVertexId)
        ) {
          if (pl.points.length >= 3) {
            const area = computeContourArea(pl.points);
            loops.push({ points: [...pl.points], area });
          }
          pl.points = [];
        } else {
          pl.consumed = false;
        }
        break;
      }

      // Join polylines
      const next = nextRef.polyline;
      if (nextRef.isStart) {
        pl.points.push(...next.points.slice(1));
        pl.endVertexId = next.endVertexId;
        pl.endEdgeId = next.endEdgeId;
      } else {
        const reversed = [...next.points].reverse();
        pl.points.push(...reversed.slice(1));
        pl.endVertexId = next.startVertexId;
        pl.endEdgeId = next.startEdgeId;
      }

      pl.length += next.length;
      next.points = [];
      next.consumed = true;
    }
  }
}

/**
 * Close gaps between open polylines within tolerance.
 * Based on OrcaSlicer's chain_open_polylines_close_gaps().
 */
function chainOpenPolylinesCloseGaps(
  openPolylines: OpenPolyline[],
  loops: RawPolygon[],
  maxGap: number,
  tryReversed: boolean
): void {
  // Update lengths and filter
  for (const pl of openPolylines) {
    if (!pl.consumed && pl.points.length > 0) {
      pl.length = polylineLength(pl.points);
    }
  }

  const active = openPolylines.filter(pl => !pl.consumed && pl.points.length > 0);
  active.sort((a, b) => b.length - a.length);

  for (const pl of active) {
    if (pl.consumed || pl.points.length === 0) continue;
    pl.consumed = true;
    let nSegmentsJoined = 1;

    while (true) {
      // Check if we can close this polyline
      const closingDist = vec2Distance(pl.points[0], pl.points[pl.points.length - 1]);

      // Find nearest endpoint
      let nearestDist = Infinity;
      let nearestPl: OpenPolyline | null = null;
      let nearestIsStart = true;

      for (const other of active) {
        if (other === pl || other.consumed || other.points.length === 0) continue;

        const distToStart = vec2Distance(pl.points[pl.points.length - 1], other.points[0]);
        const distToEnd = vec2Distance(pl.points[pl.points.length - 1], other.points[other.points.length - 1]);

        if (distToStart < nearestDist && distToStart <= maxGap) {
          nearestDist = distToStart;
          nearestPl = other;
          nearestIsStart = true;
        }
        if (tryReversed && distToEnd < nearestDist && distToEnd <= maxGap) {
          nearestDist = distToEnd;
          nearestPl = other;
          nearestIsStart = false;
        }
      }

      // Decide whether to close loop or connect to another polyline
      const canClose = closingDist <= maxGap;
      const shouldClose = canClose && (nearestPl === null || closingDist <= nearestDist);

      // OrcaSlicer heuristic: avoid closing loops shorter than max_gap
      const loopTooShort = shouldClose && Math.sqrt(closingDist * closingDist) < 0.3 * polylineLength(pl.points);

      if (shouldClose && !loopTooShort) {
        // Close the loop
        if (pl.points.length >= 3) {
          // Remove duplicate endpoint if present
          if (vec2Equal(pl.points[0], pl.points[pl.points.length - 1], 1e-9)) {
            pl.points.pop();
          }
          if (pl.points.length >= 3) {
            // OrcaSlicer: if patched from multiple segments and area negative, reverse to CCW
            let area = computeContourArea(pl.points);
            if (tryReversed && nSegmentsJoined > 1 && area < 0) {
              pl.points.reverse();
              area = -area;
            }
            loops.push({ points: [...pl.points], area });
          }
        }
        pl.points = [];
        break;
      }

      if (!nearestPl) {
        // Can't connect or close - leave as open
        pl.consumed = false;
        break;
      }

      // Connect to nearest
      const otherPoints = nearestIsStart ? nearestPl.points : [...nearestPl.points].reverse();
      // Skip first point if it's the same as our last
      const startIdx = vec2Equal(pl.points[pl.points.length - 1], otherPoints[0], 1e-9) ? 1 : 0;
      pl.points.push(...otherPoints.slice(startIdx));

      nSegmentsJoined++;
      nearestPl.points = [];
      nearestPl.consumed = true;
    }
  }
}

/**
 * Simplify a contour by removing nearly collinear points.
 * Uses Ramer-Douglas-Peucker algorithm.
 */
function simplifyContour(points: Vector2[], tolerance: number): Vector2[] {
  if (points.length <= 3) return points;

  // For closed polygons, we need special handling
  // Simplify each edge sequence separately to preserve corners
  const simplified = rdpSimplifyPolygon(points, tolerance);

  return simplified.length >= 3 ? simplified : points;
}

/**
 * Ramer-Douglas-Peucker for closed polygons.
 */
function rdpSimplifyPolygon(points: Vector2[], tolerance: number): Vector2[] {
  if (points.length <= 3) return points;

  // Find the two points furthest apart to use as split points
  let maxDist = 0;
  let splitIdx = 0;

  for (let i = 1; i < points.length; i++) {
    const dist = vec2Distance(points[0], points[i]);
    if (dist > maxDist) {
      maxDist = dist;
      splitIdx = i;
    }
  }

  // Simplify each half
  const firstHalf = points.slice(0, splitIdx + 1);
  const secondHalf = [...points.slice(splitIdx), points[0]];

  const simplified1 = rdpSimplify(firstHalf, tolerance);
  const simplified2 = rdpSimplify(secondHalf, tolerance);

  // Merge, avoiding duplicate points at the joins
  const result = [...simplified1.slice(0, -1), ...simplified2.slice(0, -1)];

  return result;
}

/**
 * Ramer-Douglas-Peucker line simplification.
 */
function rdpSimplify(points: Vector2[], tolerance: number): Vector2[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = rdpSimplify(points.slice(0, maxIdx + 1), tolerance);
    const right = rdpSimplify(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  } else {
    return [first, last];
  }
}

/**
 * Calculate perpendicular distance from point to line segment.
 */
function perpendicularDistance(point: Vector2, lineStart: Vector2, lineEnd: Vector2): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-12) {
    return vec2Distance(point, lineStart);
  }

  const t = Math.max(0, Math.min(1,
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq
  ));

  const proj = vec2(
    lineStart.x + t * dx,
    lineStart.y + t * dy
  );

  return vec2Distance(point, proj);
}

/**
 * Calculate total length of a polyline.
 */
function polylineLength(points: Vector2[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += vec2Distance(points[i - 1], points[i]);
  }
  return len;
}
