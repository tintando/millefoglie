import { IndexedMesh, Triangle } from '../types/geometry';
import { Slice, SliceConfig, SliceResult, Contour } from '../types/slice';
import { AlignmentRod, RodIntersection } from '../types/rod';
import { sliceMeshAtZ } from './PlaneIntersection';
import { buildContours, ContourBuilderConfig } from './ContourBuilder';
import { detectFloatingSections } from './OverhangDetector';
import { computeRodIntersections, generateRodHoles } from './AlignmentRodManager';

/**
 * Options for slicing operation.
 */
export interface SliceOptions {
  /** Whether to simplify contours by removing collinear points */
  simplifyContours?: boolean;
  /** Simplification tolerance in mm */
  simplifyTolerance?: number;
  /** Whether to detect overhanging/floating sections */
  detectOverhangs?: boolean;
  /** Maximum gap to close when building contours (mm) */
  maxGap?: number;
  /** Progress callback (0-100) */
  onProgress?: (percent: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<SliceOptions, 'onProgress'>> = {
  simplifyContours: true,
  simplifyTolerance: 0.01,
  detectOverhangs: true,
  maxGap: 2.0, // OrcaSlicer default
};

/**
 * Slicer class for converting 3D mesh to 2D layer contours.
 *
 * This implementation is based on OrcaSlicer's algorithms:
 * - Triangle-plane intersection for generating segments
 * - Segment chaining by edge/vertex connectivity
 * - Gap closing for handling mesh imperfections
 * - Overhang detection for floating sections
 */
export class Slicer {
  private mesh: IndexedMesh;
  private triangles: Triangle[];
  private alignmentRods: AlignmentRod[] = [];
  private rodIntersections: Map<string, RodIntersection> = new Map();

  // Cached slice data for single-layer requests
  private cachedSlices: Map<number, Slice> = new Map();
  private cachedConfig: SliceConfig | null = null;
  private cachedOptions: SliceOptions | null = null;

  constructor(mesh: IndexedMesh) {
    this.mesh = mesh;
    this.triangles = this.buildTriangles();
  }

  /**
   * Build Triangle array from indexed mesh for rod intersection tests.
   */
  private buildTriangles(): Triangle[] {
    return this.mesh.triangles.map(indices => ({
      v0: this.mesh.vertices[indices[0]],
      v1: this.mesh.vertices[indices[1]],
      v2: this.mesh.vertices[indices[2]],
    }));
  }

  /**
   * Set alignment rods for generating registration holes.
   */
  setAlignmentRods(rods: AlignmentRod[]): void {
    this.alignmentRods = rods;
    // Invalidate cache when rods change
    this.cachedSlices.clear();
    this.rodIntersections.clear();
  }

  /**
   * Get the current alignment rods.
   */
  getAlignmentRods(): AlignmentRod[] {
    return this.alignmentRods;
  }

  /**
   * Slice the mesh at all Z heights according to configuration.
   *
   * @param config Slice configuration (thickness, start/end Z)
   * @param options Slicing options
   * @returns Complete slice result with all layers
   */
  slice(config: SliceConfig, options: SliceOptions = {}): SliceResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { min, max } = this.mesh.boundingBox;

    // Determine Z range
    const startZ = config.startZ ?? min.z;
    const endZ = config.endZ ?? max.z;
    const thickness = config.thickness;

    // Calculate layer heights
    // Slice at the middle of each layer for better representation
    const layerHeights: number[] = [];
    for (let z = startZ + thickness / 2; z <= endZ; z += thickness) {
      layerHeights.push(z);
    }

    // Compute rod intersections if rods are present
    if (this.alignmentRods.length > 0) {
      this.rodIntersections = computeRodIntersections(
        this.alignmentRods,
        this.triangles,
        layerHeights
      );
    }

    // Slice each layer
    const slices: Slice[] = [];
    let prevContours: Contour[] | null = null;

    // Calculate 2D bounding box
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < layerHeights.length; i++) {
      const z = layerHeights[i];

      // Report progress
      if (opts.onProgress) {
        opts.onProgress(Math.round((i / layerHeights.length) * 100));
      }

      const slice = this.sliceAtZ(z, i, config, opts, prevContours);
      slices.push(slice);

      // Update 2D bounding box
      for (const contour of slice.contours) {
        for (const point of contour.points) {
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        }
      }

      prevContours = slice.contours;

      // Cache for single-layer requests
      this.cachedSlices.set(i, slice);
    }

    this.cachedConfig = config;
    this.cachedOptions = options;

    if (opts.onProgress) {
      opts.onProgress(100);
    }

    return {
      slices,
      layerCount: slices.length,
      modelHeight: endZ - startZ,
      boundingBox: {
        minX: isFinite(minX) ? minX : 0,
        maxX: isFinite(maxX) ? maxX : 0,
        minY: isFinite(minY) ? minY : 0,
        maxY: isFinite(maxY) ? maxY : 0,
      },
    };
  }

  /**
   * Slice a single layer by index.
   * Uses cache if available and config matches.
   *
   * @param layerIndex Layer index to slice
   * @param config Slice configuration
   * @returns Slice for the requested layer, or null if out of range
   */
  sliceSingleLayer(layerIndex: number, config: SliceConfig): Slice | null {
    const { min, max } = this.mesh.boundingBox;
    const startZ = config.startZ ?? min.z;
    const endZ = config.endZ ?? max.z;
    const thickness = config.thickness;

    // Calculate the Z height for this layer
    const z = startZ + thickness / 2 + layerIndex * thickness;

    if (z > endZ) {
      return null;
    }

    // Check cache
    if (this.cachedConfig &&
        this.cachedConfig.thickness === config.thickness &&
        this.cachedSlices.has(layerIndex)) {
      return this.cachedSlices.get(layerIndex)!;
    }

    // Need to compute - get previous layer's contours for overhang detection
    let prevContours: Contour[] | null = null;
    if (layerIndex > 0 && this.cachedSlices.has(layerIndex - 1)) {
      prevContours = this.cachedSlices.get(layerIndex - 1)!.contours;
    }

    const opts = this.cachedOptions || DEFAULT_OPTIONS;
    return this.sliceAtZ(z, layerIndex, config, opts as Required<Omit<SliceOptions, 'onProgress'>>, prevContours);
  }

  /**
   * Internal method to slice at a specific Z height.
   */
  private sliceAtZ(
    z: number,
    layerIndex: number,
    _config: SliceConfig,
    opts: Required<Omit<SliceOptions, 'onProgress'>>,
    prevContours: Contour[] | null
  ): Slice {
    // Get intersection segments at this Z
    const segments = sliceMeshAtZ(this.mesh, z);

    // Build contours from segments
    const contourConfig: Partial<ContourBuilderConfig> = {
      maxGap: opts.maxGap,
      simplify: opts.simplifyContours,
      simplifyTolerance: opts.simplifyTolerance,
    };

    const contours = buildContours(segments, contourConfig);

    // Detect floating sections
    const floatingSections = opts.detectOverhangs
      ? detectFloatingSections(contours, prevContours)
      : [];

    // Generate rod holes
    const { min, max } = this.mesh.boundingBox;
    const rodHoles = this.alignmentRods.length > 0
      ? generateRodHoles(
          this.alignmentRods,
          this.rodIntersections,
          layerIndex,
          contours,
          z,
          min.z,
          max.z
        )
      : [];

    return {
      layerIndex,
      zHeight: z,
      contours,
      floatingSections,
      rodHoles,
    };
  }

  /**
   * Get the number of layers for a given configuration.
   */
  getLayerCount(config: SliceConfig): number {
    const { min, max } = this.mesh.boundingBox;
    const startZ = config.startZ ?? min.z;
    const endZ = config.endZ ?? max.z;
    const thickness = config.thickness;

    return Math.floor((endZ - startZ) / thickness);
  }

  /**
   * Get the Z height for a given layer index.
   */
  getLayerHeight(layerIndex: number, config: SliceConfig): number {
    const { min } = this.mesh.boundingBox;
    const startZ = config.startZ ?? min.z;
    const thickness = config.thickness;

    return startZ + thickness / 2 + layerIndex * thickness;
  }

  /**
   * Clear the slice cache.
   */
  clearCache(): void {
    this.cachedSlices.clear();
    this.cachedConfig = null;
    this.cachedOptions = null;
  }

  /**
   * Get mesh bounding box.
   */
  getBoundingBox() {
    return this.mesh.boundingBox;
  }
}
