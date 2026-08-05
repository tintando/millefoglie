import * as THREE from 'three';
import { Vector3, Triangle, BoundingBox, IndexedMesh, computeBoundingBox } from '../types/geometry';

/**
 * Convert a Three.js BufferGeometry (from STL) to our indexed mesh format.
 */
export function bufferGeometryToIndexedMesh(geometry: THREE.BufferGeometry): IndexedMesh {
  // Ensure we have the position attribute
  const positionAttr = geometry.getAttribute('position');
  if (!positionAttr) {
    throw new Error('Geometry has no position attribute');
  }

  // Extract vertices and build index
  const vertices: Vector3[] = [];
  const triangles: number[][] = [];
  const vertexMap = new Map<string, number>();

  const epsilon = 1e-6;

  function getOrCreateVertex(x: number, y: number, z: number): number {
    // Quantize for deduplication
    const qx = Math.round(x / epsilon) * epsilon;
    const qy = Math.round(y / epsilon) * epsilon;
    const qz = Math.round(z / epsilon) * epsilon;
    const key = `${qx.toFixed(6)},${qy.toFixed(6)},${qz.toFixed(6)}`;

    if (vertexMap.has(key)) {
      return vertexMap.get(key)!;
    }

    const index = vertices.length;
    vertices.push({ x, y, z });
    vertexMap.set(key, index);
    return index;
  }

  // Process triangles
  const count = positionAttr.count;
  for (let i = 0; i < count; i += 3) {
    const v0 = getOrCreateVertex(
      positionAttr.getX(i),
      positionAttr.getY(i),
      positionAttr.getZ(i)
    );
    const v1 = getOrCreateVertex(
      positionAttr.getX(i + 1),
      positionAttr.getY(i + 1),
      positionAttr.getZ(i + 1)
    );
    const v2 = getOrCreateVertex(
      positionAttr.getX(i + 2),
      positionAttr.getY(i + 2),
      positionAttr.getZ(i + 2)
    );

    // Skip degenerate triangles
    if (v0 !== v1 && v1 !== v2 && v2 !== v0) {
      triangles.push([v0, v1, v2]);
    }
  }

  const boundingBox = computeBoundingBox(vertices);

  return {
    vertices,
    triangles,
    boundingBox,
  };
}

/**
 * Convert indexed mesh to array of Triangle objects for slicing.
 */
export function indexedMeshToTriangles(mesh: IndexedMesh): Triangle[] {
  return mesh.triangles.map(indices => ({
    v0: mesh.vertices[indices[0]],
    v1: mesh.vertices[indices[1]],
    v2: mesh.vertices[indices[2]],
  }));
}

/**
 * Get mesh statistics for display.
 */
export function getMeshStats(mesh: IndexedMesh): {
  vertexCount: number;
  triangleCount: number;
  boundingBox: BoundingBox;
  dimensions: { width: number; height: number; depth: number };
} {
  const { boundingBox } = mesh;

  return {
    vertexCount: mesh.vertices.length,
    triangleCount: mesh.triangles.length,
    boundingBox,
    dimensions: {
      width: boundingBox.max.x - boundingBox.min.x,
      height: boundingBox.max.y - boundingBox.min.y,
      depth: boundingBox.max.z - boundingBox.min.z,
    },
  };
}

/**
 * Center the mesh at origin (XY) and place bottom at Z=0.
 */
export function centerMesh(mesh: IndexedMesh): IndexedMesh {
  const { boundingBox } = mesh;
  const centerX = (boundingBox.min.x + boundingBox.max.x) / 2;
  const centerY = (boundingBox.min.y + boundingBox.max.y) / 2;
  const bottomZ = boundingBox.min.z;

  const newVertices = mesh.vertices.map(v => ({
    x: v.x - centerX,
    y: v.y - centerY,
    z: v.z - bottomZ,
  }));

  return {
    vertices: newVertices,
    triangles: mesh.triangles,
    boundingBox: computeBoundingBox(newVertices),
  };
}

/**
 * Scale mesh uniformly.
 */
export function scaleMesh(mesh: IndexedMesh, scale: number): IndexedMesh {
  const newVertices = mesh.vertices.map(v => ({
    x: v.x * scale,
    y: v.y * scale,
    z: v.z * scale,
  }));

  return {
    vertices: newVertices,
    triangles: mesh.triangles,
    boundingBox: computeBoundingBox(newVertices),
  };
}
