import { Vector2, vec2 } from '../types/geometry';
import { Triangle } from '../types/geometry';
import { Contour, RodHole, isPointInContour } from '../types/slice';
import { AlignmentRod, RodIntersection, ContinuousSection } from '../types/rod';

/**
 * Compute which layers each rod intersects with the model.
 * Returns a map of rod ID to intersection information.
 */
export function computeRodIntersections(
  rods: AlignmentRod[],
  triangles: Triangle[],
  layerHeights: number[]
): Map<string, RodIntersection> {
  const intersections = new Map<string, RodIntersection>();

  for (const rod of rods) {
    const layerIndices: number[] = [];

    // For each layer, check if the rod position is inside the model at that height
    // We do this by ray casting - check if the point is inside any triangle at that z
    for (let i = 0; i < layerHeights.length; i++) {
      const z = layerHeights[i];
      if (isPointInsideModelAtZ(rod.position, z, triangles)) {
        layerIndices.push(i);
      }
    }

    // Find continuous sections
    const continuousSections = findContinuousSections(layerIndices);

    intersections.set(rod.id, {
      rodId: rod.id,
      layerIndices,
      continuousSections,
    });
  }

  return intersections;
}

/**
 * Check if a 2D point is inside the model at a given Z height.
 * Uses ray casting along the Z axis.
 */
function isPointInsideModelAtZ(point: Vector2, z: number, triangles: Triangle[]): boolean {
  // Cast a ray from (point.x, point.y, -infinity) upward
  // Count how many triangles it intersects below z
  let intersectionCount = 0;

  for (const tri of triangles) {
    const { v0, v1, v2 } = tri;

    // Check if the point's XY is inside the triangle's XY projection
    if (!isPointInTriangleXY(point, v0, v1, v2)) continue;

    // Find Z at this XY point using barycentric interpolation
    const zAtPoint = interpolateZInTriangle(point, v0, v1, v2);

    // Count if this intersection is below our target z
    if (zAtPoint !== null && zAtPoint < z) {
      intersectionCount++;
    }
  }

  // Odd number of intersections means inside
  return intersectionCount % 2 === 1;
}

/**
 * Check if a 2D point is inside a triangle (XY projection).
 */
function isPointInTriangleXY(
  p: Vector2,
  v0: { x: number; y: number },
  v1: { x: number; y: number },
  v2: { x: number; y: number }
): boolean {
  const d1 = sign(p, v0, v1);
  const d2 = sign(p, v1, v2);
  const d3 = sign(p, v2, v0);

  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);

  return !(hasNeg && hasPos);
}

function sign(
  p1: Vector2,
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): number {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}

/**
 * Interpolate Z value at a given XY point within a triangle.
 */
function interpolateZInTriangle(
  p: Vector2,
  v0: { x: number; y: number; z: number },
  v1: { x: number; y: number; z: number },
  v2: { x: number; y: number; z: number }
): number | null {
  // Compute barycentric coordinates
  const d = (v1.y - v2.y) * (v0.x - v2.x) + (v2.x - v1.x) * (v0.y - v2.y);
  if (Math.abs(d) < 1e-10) return null;

  const u = ((v1.y - v2.y) * (p.x - v2.x) + (v2.x - v1.x) * (p.y - v2.y)) / d;
  const v = ((v2.y - v0.y) * (p.x - v2.x) + (v0.x - v2.x) * (p.y - v2.y)) / d;
  const w = 1 - u - v;

  // Check if point is inside triangle
  if (u < -1e-6 || v < -1e-6 || w < -1e-6) return null;

  // Interpolate Z
  return u * v0.z + v * v1.z + w * v2.z;
}

/**
 * Find continuous sections from a list of layer indices.
 * A continuous section is a run of consecutive layer indices.
 */
function findContinuousSections(layerIndices: number[]): ContinuousSection[] {
  if (layerIndices.length === 0) return [];

  const sorted = [...layerIndices].sort((a, b) => a - b);
  const sections: ContinuousSection[] = [];

  let startLayer = sorted[0];
  let prevLayer = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const currentLayer = sorted[i];

    if (currentLayer !== prevLayer + 1) {
      // Gap found, end current section
      sections.push({ startLayer, endLayer: prevLayer });
      startLayer = currentLayer;
    }

    prevLayer = currentLayer;
  }

  // Add the last section
  sections.push({ startLayer, endLayer: prevLayer });

  return sections;
}

/**
 * Rod holes for one layer, judged from that layer alone: the rod covers this
 * Z and lands in solid material. Used to preview staged rod edits, where
 * re-slicing the model on every drag would be far too slow.
 *
 * Cheaper than generateRodHoles and slightly more generous, since without the
 * neighbouring layers it cannot tell that a layer starts or ends a continuous
 * section. Those layers keep their holes here and lose them once the changes
 * are applied, so the preview can show a hole the final cut will not have.
 */
export function previewRodHoles(
  rods: AlignmentRod[],
  contours: Contour[],
  layerZ: number,
  modelMinZ: number,
  modelMaxZ: number
): RodHole[] {
  const holes: RodHole[] = [];
  const modelHeight = modelMaxZ - modelMinZ;
  if (modelHeight <= 0) return holes;

  const normalizedZ = (layerZ - modelMinZ) / modelHeight;

  for (const rod of rods) {
    if (normalizedZ < rod.bottomZ || normalizedZ > rod.topZ) continue;

    let isInsideContour = false;
    for (const contour of contours) {
      if (!contour.isHole && isPointInContour(rod.position, contour)) {
        isInsideContour = true;
        break;
      }
    }

    if (isInsideContour) {
      holes.push({
        center: vec2(rod.position.x, rod.position.y),
        diameter: rod.diameter,
        rodId: rod.id,
      });
    }
  }

  return holes;
}

/**
 * Generate rod holes for a specific layer.
 * Holes are not generated for the first and last layer of each continuous section,
 * and only within the rod's specified height range (bottomZ to topZ).
 */
export function generateRodHoles(
  rods: AlignmentRod[],
  rodIntersections: Map<string, RodIntersection>,
  layerIndex: number,
  contours: Contour[],
  layerZ: number,
  modelMinZ: number,
  modelMaxZ: number
): RodHole[] {
  const holes: RodHole[] = [];
  const modelHeight = modelMaxZ - modelMinZ;

  for (const rod of rods) {
    const intersection = rodIntersections.get(rod.id);
    if (!intersection) continue;

    // Check if this layer is in the rod's intersection range
    if (!intersection.layerIndices.includes(layerIndex)) continue;

    // Check if this layer's Z height is within the rod's height range
    const normalizedZ = (layerZ - modelMinZ) / modelHeight;
    if (normalizedZ < rod.bottomZ || normalizedZ > rod.topZ) continue;

    // Check if this is first or last layer of a continuous section
    let skipHole = false;
    for (const section of intersection.continuousSections) {
      if (layerIndex === section.startLayer || layerIndex === section.endLayer) {
        skipHole = true;
        break;
      }
    }

    if (skipHole) continue;

    // Verify rod position is inside a contour at this layer
    let isInsideContour = false;
    for (const contour of contours) {
      if (!contour.isHole && isPointInContour(rod.position, contour)) {
        isInsideContour = true;
        break;
      }
    }

    if (isInsideContour) {
      holes.push({
        center: vec2(rod.position.x, rod.position.y),
        diameter: rod.diameter,
        rodId: rod.id,
      });
    }
  }

  return holes;
}

/**
 * Create a circular contour for a rod hole.
 * This can be used to add the hole as a contour in the slice.
 */
export function createCircularHoleContour(hole: RodHole, segments: number = 32): Contour {
  const points: Vector2[] = [];
  const radius = hole.diameter / 2;

  // Generate points in clockwise order (hole)
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    points.push(vec2(
      hole.center.x + radius * Math.cos(angle),
      hole.center.y - radius * Math.sin(angle) // Negative for clockwise
    ));
  }

  return {
    points,
    isHole: true,
    area: Math.PI * radius * radius,
  };
}
