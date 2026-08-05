import { Slice, Contour, RodHole } from '../types/slice';
import { generateNumber } from '../packing/SingleStrokeFont';
import { Stroke } from '../packing/types';
import {
  findSliceLabelPlacements,
  LabelPlacementConfig,
  DEFAULT_LABEL_CONFIG,
} from '../packing/LabelPlacement';

/**
 * Colours used when rendering a slice. Only the on-screen preview overrides
 * these; every exporter omits the field and gets DEFAULT_SLICE_PALETTE, so
 * exported SVGs stay byte-identical.
 */
export interface SlicePalette {
  fill: string;
  hole: string;
  stroke: string;
  floatingFill: string;
  floatingStroke: string;
  holeStroke: string;
  labelStroke: string;
}

export const DEFAULT_SLICE_PALETTE: SlicePalette = {
  fill: '#f0f0f0',
  hole: 'white',
  stroke: '#000',
  floatingFill: '#ffcc00',
  floatingStroke: '#ff6600',
  holeStroke: '#0066cc',
  labelStroke: '#000',
};

export interface SliceRenderConfig {
  strokeWidth: number;
  showLabelCut: boolean;
  showFloating: boolean;
  labelHeight?: number;
  /** Preview-only colour override; exporters leave this unset. */
  palette?: SlicePalette;
}

/**
 * Convert stroke commands to SVG path data
 */
function strokeToPathData(stroke: Stroke): string {
  if (stroke.length === 0) return '';

  let d = '';
  for (const cmd of stroke) {
    switch (cmd.type) {
      case 'M':
        d += `M ${cmd.point.x.toFixed(3)} ${cmd.point.y.toFixed(3)} `;
        break;
      case 'L':
        d += `L ${cmd.point.x.toFixed(3)} ${cmd.point.y.toFixed(3)} `;
        break;
      case 'Q':
        d += `Q ${cmd.control.x.toFixed(3)} ${cmd.control.y.toFixed(3)} ${cmd.end.x.toFixed(3)} ${cmd.end.y.toFixed(3)} `;
        break;
      case 'C':
        d += `C ${cmd.c1.x.toFixed(3)} ${cmd.c1.y.toFixed(3)} ${cmd.c2.x.toFixed(3)} ${cmd.c2.y.toFixed(3)} ${cmd.end.x.toFixed(3)} ${cmd.end.y.toFixed(3)} `;
        break;
    }
  }
  return d.trim();
}

/**
 * Generate SVG content for a slice (contours, holes, labels)
 * Returns SVG elements as a string, to be placed inside a <g> with Y-flip transform
 */
export function renderSliceContent(slice: Slice, config: SliceRenderConfig): string {
  const { strokeWidth, showLabelCut, showFloating, labelHeight = 5, palette = DEFAULT_SLICE_PALETTE } = config;
  let svg = '';

  // Draw contours
  for (let i = 0; i < slice.contours.length; i++) {
    const contour = slice.contours[i];
    const isFloating = showFloating && slice.floatingSections.includes(i);
    svg += generateContourPath(contour, strokeWidth, isFloating, palette);
  }

  // Draw rod holes
  for (const hole of slice.rodHoles) {
    svg += generateHoleCircle(hole, strokeWidth, palette);
  }

  // Add label cuts
  if (showLabelCut) {
    svg += generateLabelCuts(slice, strokeWidth, labelHeight, palette);
  }

  return svg;
}

function generateContourPath(contour: Contour, strokeWidth: number, isFloating: boolean, palette: SlicePalette): string {
  if (contour.points.length < 3) return '';

  let d = `M ${contour.points[0].x} ${contour.points[0].y}`;
  for (let i = 1; i < contour.points.length; i++) {
    d += ` L ${contour.points[i].x} ${contour.points[i].y}`;
  }
  d += ' Z';

  const fill = contour.isHole ? palette.hole : (isFloating ? palette.floatingFill : palette.fill);
  const stroke = isFloating ? palette.floatingStroke : palette.stroke;

  return `  <path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>\n`;
}

function generateHoleCircle(hole: RodHole, strokeWidth: number, palette: SlicePalette): string {
  return `  <circle cx="${hole.center.x}" cy="${hole.center.y}" r="${hole.diameter / 2}" fill="${palette.hole}" stroke="${palette.holeStroke}" stroke-width="${strokeWidth}"/>\n`;
}

function generateLabelCuts(slice: Slice, strokeWidth: number, numberHeight: number, palette: SlicePalette): string {
  let result = '  <!-- Label cuts -->\n';
  let hasLabels = false;

  // Configure label placement
  const config: LabelPlacementConfig = {
    ...DEFAULT_LABEL_CONFIG,
    preferredHeight: numberHeight,
    heightSteps: [numberHeight, 4, 3, 2].filter(h => h >= DEFAULT_LABEL_CONFIG.minimumHeight),
  };

  // Find placements for all contours at once (handles collision between labels and contours)
  const placements = findSliceLabelPlacements(slice.contours, slice.layerIndex + 1, config);

  // Render each label
  for (const [_contour, placement] of placements) {
    const { position, height } = placement;

    // Generate layer number at found position
    const strokes = generateNumber(slice.layerIndex + 1, position, height);

    // Wrap in a group with counter-flip to correct for parent's Y-flip
    result += `  <g transform="translate(${position.x}, ${position.y}) scale(1, -1) translate(${-position.x}, ${-position.y})">\n`;
    for (const stroke of strokes) {
      const pathData = strokeToPathData(stroke);
      result += `    <path d="${pathData}" fill="none" stroke="${palette.labelStroke}" stroke-width="${strokeWidth}"/>\n`;
    }
    result += `  </g>\n`;
    hasLabels = true;
  }

  return hasLabels ? result : '';
}

/**
 * Calculate the bounding box of a slice
 */
export function getSliceBounds(slice: Slice): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const contour of slice.contours) {
    for (const point of contour.points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }

  // Add rod holes to bounds
  for (const hole of slice.rodHoles) {
    const r = hole.diameter / 2;
    minX = Math.min(minX, hole.center.x - r);
    maxX = Math.max(maxX, hole.center.x + r);
    minY = Math.min(minY, hole.center.y - r);
    maxY = Math.max(maxY, hole.center.y + r);
  }

  if (!isFinite(minX)) {
    return null;
  }

  return { minX, maxX, minY, maxY };
}
