import { Contour, doContoursOverlap, isPointInContour } from '../types/slice';

/**
 * Result of overhang detection for a single contour.
 */
export interface OverhangInfo {
  /** Index of the contour in the slice */
  contourIndex: number;
  /** Whether this contour is completely unsupported (floating) */
  isFloating: boolean;
  /** Approximate percentage of the contour area that has support (0-100) */
  supportPercentage: number;
}

/**
 * Detect floating/overhanging sections by comparing current layer contours
 * with the previous layer's contours.
 *
 * A contour is considered floating if it has no overlap with any contour
 * from the layer below. This is a simplified approach compared to OrcaSlicer's
 * BridgeDetector which calculates exact unsupported edges.
 *
 * @param currentContours Contours of the current layer
 * @param previousContours Contours of the layer below (null for first layer)
 * @returns Array of indices of floating contours
 */
export function detectFloatingSections(
  currentContours: Contour[],
  previousContours: Contour[] | null
): number[] {
  // First layer has no floating sections (it sits on the build plate)
  if (!previousContours || previousContours.length === 0) {
    return [];
  }

  const floatingIndices: number[] = [];

  // Only check outer contours (non-holes)
  const prevOuter = previousContours.filter(c => !c.isHole);

  for (let i = 0; i < currentContours.length; i++) {
    const contour = currentContours[i];

    // Skip holes - they can't be "floating"
    if (contour.isHole) continue;

    // Check if this contour overlaps with any contour from the previous layer
    let hasSupport = false;

    for (const prevContour of prevOuter) {
      if (doContoursOverlap(contour, prevContour)) {
        hasSupport = true;
        break;
      }
    }

    if (!hasSupport) {
      floatingIndices.push(i);
    }
  }

  return floatingIndices;
}

/**
 * Get detailed overhang information for all contours in a layer.
 *
 * This provides more granular information than detectFloatingSections(),
 * including approximate support percentages.
 *
 * @param currentContours Contours of the current layer
 * @param previousContours Contours of the layer below
 * @returns Detailed overhang info for each non-hole contour
 */
export function analyzeOverhangs(
  currentContours: Contour[],
  previousContours: Contour[] | null
): OverhangInfo[] {
  const results: OverhangInfo[] = [];

  // First layer is fully supported
  if (!previousContours || previousContours.length === 0) {
    for (let i = 0; i < currentContours.length; i++) {
      if (!currentContours[i].isHole) {
        results.push({
          contourIndex: i,
          isFloating: false,
          supportPercentage: 100,
        });
      }
    }
    return results;
  }

  const prevOuter = previousContours.filter(c => !c.isHole);

  for (let i = 0; i < currentContours.length; i++) {
    const contour = currentContours[i];

    if (contour.isHole) continue;

    // Sample points along the contour to estimate support coverage
    const supportedPoints = countSupportedPoints(contour, prevOuter);
    const supportPercentage = supportedPoints.supported / supportedPoints.total * 100;

    results.push({
      contourIndex: i,
      isFloating: supportPercentage < 1, // Less than 1% support = floating
      supportPercentage,
    });
  }

  return results;
}

/**
 * Count how many sample points of a contour have support from below.
 */
function countSupportedPoints(
  contour: Contour,
  previousContours: Contour[]
): { supported: number; total: number } {
  const points = contour.points;
  let supported = 0;
  const total = points.length;

  for (const point of points) {
    // Check if this point lies inside any previous contour
    for (const prev of previousContours) {
      if (isPointInContour(point, prev)) {
        supported++;
        break;
      }
    }
  }

  return { supported, total };
}

/**
 * Check if a contour is a "bridge" - spans across a gap in the layer below.
 *
 * A bridge is a contour where:
 * - It has support on at least two opposing sides
 * - But has an unsupported region in between
 *
 * This is useful for paper crafting as bridges may need extra care.
 */
export function isBridgeContour(
  contour: Contour,
  previousContours: Contour[] | null
): boolean {
  if (!previousContours || previousContours.length === 0) {
    return false;
  }

  if (contour.isHole) {
    return false;
  }

  const prevOuter = previousContours.filter(c => !c.isHole);

  // Sample points and track which ones are supported
  const points = contour.points;
  const isSupported: boolean[] = [];

  for (const point of points) {
    let supported = false;
    for (const prev of prevOuter) {
      if (isPointInContour(point, prev)) {
        supported = true;
        break;
      }
    }
    isSupported.push(supported);
  }

  // Count transitions from supported to unsupported
  let transitions = 0;
  for (let i = 0; i < isSupported.length; i++) {
    const next = (i + 1) % isSupported.length;
    if (isSupported[i] !== isSupported[next]) {
      transitions++;
    }
  }

  // A bridge has at least 4 transitions (supported -> unsupported -> supported -> unsupported)
  // and has both supported and unsupported regions
  const hasSupported = isSupported.some(s => s);
  const hasUnsupported = isSupported.some(s => !s);

  return transitions >= 4 && hasSupported && hasUnsupported;
}

/**
 * Get contours that are partially supported (overhanging but not floating).
 *
 * These are contours that extend beyond the support from the layer below.
 */
export function getOverhangingContours(
  currentContours: Contour[],
  previousContours: Contour[] | null
): number[] {
  if (!previousContours || previousContours.length === 0) {
    return [];
  }

  const overhangIndices: number[] = [];
  const prevOuter = previousContours.filter(c => !c.isHole);

  for (let i = 0; i < currentContours.length; i++) {
    const contour = currentContours[i];

    if (contour.isHole) continue;

    // Check if contour extends beyond support
    let extendsOutside = false;

    // Sample boundary points
    for (const point of contour.points) {
      let insideAnyPrev = false;
      for (const prev of prevOuter) {
        if (isPointInContour(point, prev)) {
          insideAnyPrev = true;
          break;
        }
      }
      if (!insideAnyPrev) {
        extendsOutside = true;
        break;
      }
    }

    // Must have some support to be "overhanging" (not floating)
    let hasSupport = false;
    for (const prev of prevOuter) {
      if (doContoursOverlap(contour, prev)) {
        hasSupport = true;
        break;
      }
    }

    if (extendsOutside && hasSupport) {
      overhangIndices.push(i);
    }
  }

  return overhangIndices;
}
