import { IndexedMesh, Vector2, Vector3, vec2 } from '../types/geometry';

/**
 * Intersection point on a triangle edge or vertex.
 * Stores metadata for chaining segments together.
 */
export interface IntersectionPoint {
  point: Vector2;
  // If on a vertex, stores the vertex index. -1 otherwise.
  vertexId: number;
  // If on an edge, stores edge identifier. -1 otherwise.
  edgeId: number;
}

/**
 * A segment with metadata for chaining.
 * Segments are oriented with exterior on the right (following OrcaSlicer convention).
 */
export interface IntersectionSegment {
  a: IntersectionPoint;
  b: IntersectionPoint;
}

const EPSILON = 1e-9;

/**
 * Compute intersection point of an edge with a horizontal plane.
 * Uses same linear interpolation as OrcaSlicer.
 */
function intersectEdgeWithPlane(
  v0: Vector3,
  v1: Vector3,
  planeZ: number
): Vector2 {
  // t = (planeZ - v0.z) / (v1.z - v0.z)
  // Same formula as OrcaSlicer line 261
  const t = (planeZ - v0.z) / (v1.z - v0.z);
  return vec2(
    v0.x + t * (v1.x - v0.x),
    v0.y + t * (v1.y - v0.y)
  );
}

/**
 * Create an edge ID from two vertex indices.
 * The ID is order-independent for consistent matching during chaining.
 */
function makeEdgeId(i0: number, i1: number, meshSize: number): number {
  // Sort indices for consistency (OrcaSlicer sorts a_id, b_id)
  const minIdx = Math.min(i0, i1);
  const maxIdx = Math.max(i0, i1);
  return minIdx * meshSize + maxIdx;
}

/**
 * Slice a single triangle with a horizontal plane at planeZ.
 *
 * Algorithm closely following OrcaSlicer's slice_facet():
 * - Vertices are reordered so lowest Z comes first (for consistent orientation)
 * - Handles edge cases: vertices on plane, edges on plane, horizontal triangles
 * - Returns segment oriented with exterior on the right
 *
 * Returns null if no intersection or horizontal triangle.
 */
export function sliceTriangle(
  mesh: IndexedMesh,
  triangleIndices: number[],
  planeZ: number
): IntersectionSegment | null {
  const [i0, i1, i2] = triangleIndices;
  const v0 = mesh.vertices[i0];
  const v1 = mesh.vertices[i1];
  const v2 = mesh.vertices[i2];

  // Find minimum and maximum Z
  const minZ = Math.min(v0.z, v1.z, v2.z);
  const maxZ = Math.max(v0.z, v1.z, v2.z);

  // Quick reject: plane doesn't intersect triangle's Z range
  if (planeZ < minZ - EPSILON || planeZ > maxZ + EPSILON) {
    return null;
  }

  // Horizontal triangle - ignore (OrcaSlicer behavior)
  if (maxZ - minZ < EPSILON) {
    return null;
  }

  // Find the vertex with lowest Z (for consistent ordering as per OrcaSlicer)
  let idxLowest = 0;
  if (v1.z < mesh.vertices[triangleIndices[idxLowest]].z) idxLowest = 1;
  if (v2.z < mesh.vertices[triangleIndices[idxLowest]].z) idxLowest = 2;

  const meshSize = mesh.vertices.length;
  const points: IntersectionPoint[] = [];
  let pointOnLayer = -1; // Track if we have a vertex exactly on the plane

  // Process each edge starting from lowest vertex (OrcaSlicer pattern)
  for (let j = 0; j < 3; j++) {
    const k = (idxLowest + j) % 3;
    const l = (k + 1) % 3;

    const aIdx = triangleIndices[k];
    const bIdx = triangleIndices[l];
    const a = mesh.vertices[aIdx];
    const b = mesh.vertices[bIdx];

    const aOnPlane = Math.abs(a.z - planeZ) < EPSILON;
    const bOnPlane = Math.abs(b.z - planeZ) < EPSILON;

    if (aOnPlane && bOnPlane) {
      // Edge lies on plane - handle "Top" edge case (OrcaSlicer lines 189-231)
      // Only include if third vertex is below (top edge rule)
      const thirdIdx = triangleIndices[(k + 2) % 3];
      const thirdV = mesh.vertices[thirdIdx];

      if (thirdV.z < planeZ - EPSILON) {
        // Third vertex below - this is a "Top" edge, include it reversed
        return {
          a: { point: vec2(b.x, b.y), vertexId: bIdx, edgeId: -1 },
          b: { point: vec2(a.x, a.y), vertexId: aIdx, edgeId: -1 },
        };
      }
      // Third vertex above or on plane - skip this edge
      continue;
    }

    if (aOnPlane) {
      // Vertex a is exactly on plane
      if (pointOnLayer === -1 || points[pointOnLayer]?.vertexId !== aIdx) {
        pointOnLayer = points.length;
        points.push({
          point: vec2(a.x, a.y),
          vertexId: aIdx,
          edgeId: -1,
        });
      }
    } else if (bOnPlane) {
      // Vertex b is on plane - will be handled as 'a' in next iteration
      continue;
    } else if ((a.z < planeZ && b.z > planeZ) || (a.z > planeZ && b.z < planeZ)) {
      // Edge crosses plane - general case (OrcaSlicer lines 252-282)
      // Sort edge vertices for consistent results
      let sortedA = a, sortedB = b;
      let sortedAIdx = aIdx, sortedBIdx = bIdx;
      if (aIdx > bIdx) {
        sortedA = b;
        sortedB = a;
        sortedAIdx = bIdx;
        sortedBIdx = aIdx;
      }

      const intersection = intersectEdgeWithPlane(sortedA, sortedB, planeZ);
      const edgeId = makeEdgeId(sortedAIdx, sortedBIdx, meshSize);

      points.push({
        point: intersection,
        vertexId: -1,
        edgeId: edgeId,
      });
    }
  }

  // Should have exactly 2 intersection points
  if (points.length !== 2) {
    return null;
  }

  // OrcaSlicer reverses the points (lines 1288-1294) for correct orientation
  // This ensures exterior is on the right of the segment
  return {
    a: points[1],
    b: points[0],
  };
}

/**
 * Slice all triangles in a mesh at a given Z height.
 * Returns an array of intersection segments with chaining metadata.
 */
export function sliceMeshAtZ(
  mesh: IndexedMesh,
  planeZ: number
): IntersectionSegment[] {
  const segments: IntersectionSegment[] = [];

  for (const triangleIndices of mesh.triangles) {
    const segment = sliceTriangle(mesh, triangleIndices, planeZ);
    if (segment) {
      segments.push(segment);
    }
  }

  return segments;
}
