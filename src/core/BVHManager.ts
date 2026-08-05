import * as THREE from 'three';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast
} from 'three-mesh-bvh';

// Extend Three.js prototypes to support BVH
// The three-mesh-bvh library already provides type augmentations
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/**
 * BVHManager handles Bounding Volume Hierarchy computation for accelerated raycasting.
 * This provides O(log n) raycasting instead of O(n), critical for complex models.
 */
export class BVHManager {
  private static instance: BVHManager | null = null;
  private geometriesWithBVH: WeakSet<THREE.BufferGeometry> = new WeakSet();

  private constructor() {}

  static getInstance(): BVHManager {
    if (!BVHManager.instance) {
      BVHManager.instance = new BVHManager();
    }
    return BVHManager.instance;
  }

  /**
   * Compute BVH for a geometry. This should be called after the geometry is loaded/created.
   * @param geometry The BufferGeometry to compute BVH for
   */
  computeBVH(geometry: THREE.BufferGeometry): void {
    if (this.geometriesWithBVH.has(geometry)) {
      return; // Already has BVH
    }

    try {
      geometry.computeBoundsTree({
        maxLeafTris: 10, // Good balance for most models
        strategy: 0 // SAH strategy for balanced trees
      });
      this.geometriesWithBVH.add(geometry);
    } catch (error) {
      console.warn('Failed to compute BVH for geometry:', error);
    }
  }

  /**
   * Dispose of BVH for a geometry. Call this when disposing the geometry.
   * @param geometry The BufferGeometry to dispose BVH from
   */
  disposeBVH(geometry: THREE.BufferGeometry): void {
    if (!this.geometriesWithBVH.has(geometry)) {
      return;
    }

    try {
      geometry.disposeBoundsTree();
      this.geometriesWithBVH.delete(geometry);
    } catch (error) {
      console.warn('Failed to dispose BVH for geometry:', error);
    }
  }

  /**
   * Check if a geometry has BVH computed
   */
  hasBVH(geometry: THREE.BufferGeometry): boolean {
    return this.geometriesWithBVH.has(geometry);
  }
}

export const bvhManager = BVHManager.getInstance();
