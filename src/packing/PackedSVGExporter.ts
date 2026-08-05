import { Vector2, vec2 } from '../types/geometry';
import { PackedSheet, PlacedPiece, PackingConfig, Stroke } from './types';
import { generateNumber } from './SingleStrokeFont';
import { rotatePiece } from './PieceExtractor';
import {
  findPackedLabelPlacement,
  LabelPlacementConfig,
  DEFAULT_LABEL_CONFIG,
  PlacedLabel,
} from './LabelPlacement';

/**
 * Generate SVG path data from a list of points (for contours)
 */
function pointsToPathData(points: Vector2[], close: boolean = true): string {
  if (points.length === 0) return '';

  let d = `M ${points[0].x.toFixed(3)} ${points[0].y.toFixed(3)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x.toFixed(3)} ${points[i].y.toFixed(3)}`;
  }
  if (close) {
    d += ' Z';
  }

  return d;
}

/**
 * Generate SVG path data from stroke commands (for bezier curves)
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
 * Generate SVG for a single packed sheet
 */
export function generatePackedSheetSVG(sheet: PackedSheet, config: PackingConfig): string {
  const { paperWidth, paperHeight, margin, strokeWidth, numberHeight } = config;

  // SVG header
  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${paperWidth}mm"
     height="${paperHeight}mm"
     viewBox="0 0 ${paperWidth} ${paperHeight}">
  <title>Packed Sheet ${sheet.index + 1}</title>
  <desc>Millefoglie packed export - Sheet ${sheet.index + 1} - ${sheet.pieces.length} pieces - ${(sheet.utilization * 100).toFixed(1)}% utilization</desc>

  <!-- Background -->
  <rect width="100%" height="100%" fill="white"/>

  <!-- Content area -->
  <g transform="translate(${margin}, ${margin})">
`;

  // Configure label placement
  const labelConfig: LabelPlacementConfig = {
    ...DEFAULT_LABEL_CONFIG,
    preferredHeight: numberHeight,
    heightSteps: [numberHeight, 4, 3, 2].filter(h => h >= DEFAULT_LABEL_CONFIG.minimumHeight),
  };

  // Track placed labels to avoid collisions between labels
  const placedLabels: PlacedLabel[] = [];

  // Draw each placed piece
  for (let i = 0; i < sheet.pieces.length; i++) {
    const placed = sheet.pieces[i];
    const transformed = getTransformedPiece(placed);
    const layerNum = placed.piece.layerIndex + 1; // 1-indexed for display

    svg += `    <!-- Layer ${layerNum} -->\n`;
    svg += `    <g>\n`;

    // Outer contour
    const outerPath = pointsToPathData(transformed.outerContour);
    svg += `      <path d="${outerPath}" fill="none" stroke="#000" stroke-width="${strokeWidth}"/>\n`;

    // Holes
    for (const hole of transformed.holes) {
      const holePath = pointsToPathData(hole);
      svg += `      <path d="${holePath}" fill="none" stroke="#000" stroke-width="${strokeWidth}"/>\n`;
    }

    // Layer number (single-stroke) with smart placement - only if showLabelCut is enabled
    if (config.showLabelCut !== false) {
      // Find other pieces for collision checking
      const otherPieces = sheet.pieces.filter((_, j) => j !== i);

      // Find optimal label placement considering other pieces and already-placed labels
      const placement = findPackedLabelPlacement(placed, otherPieces, labelConfig, placedLabels);

      const numberStrokes = generateNumber(layerNum, placement.position, placement.height);
      for (const stroke of numberStrokes) {
        const strokePath = strokeToPathData(stroke);
        svg += `      <path d="${strokePath}" fill="none" stroke="#000" stroke-width="${strokeWidth}"/>\n`;
      }

      // Track this label for future collision checks
      placedLabels.push({
        position: placement.position,
        width: placement.width,
        height: placement.height,
      });
    }

    svg += `    </g>\n`;
  }

  svg += `  </g>
</svg>`;

  return svg;
}

/**
 * Generate SVGs for all packed sheets
 */
export function generateAllPackedSheetsSVG(sheets: PackedSheet[], config: PackingConfig): string[] {
  return sheets.map(sheet => generatePackedSheetSVG(sheet, config));
}

/**
 * Download a packed sheet as SVG
 */
export function downloadPackedSheet(sheet: PackedSheet, config: PackingConfig, filename?: string): void {
  const svg = generatePackedSheetSVG(sheet, config);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `packed_sheet_${String(sheet.index + 1).padStart(3, '0')}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

/**
 * Download all packed sheets as individual SVG files (in a ZIP)
 */
export async function downloadPackedSheetsZip(
  sheets: PackedSheet[],
  config: PackingConfig,
  filename: string = 'packed_sheets.zip'
): Promise<void> {
  // Dynamic import of JSZip
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  for (const sheet of sheets) {
    const svg = generatePackedSheetSVG(sheet, config);
    const name = `packed_sheet_${String(sheet.index + 1).padStart(3, '0')}.svg`;
    zip.file(name, svg);
  }

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

/**
 * Packing exporter class for integration with App
 */
export class PackedSVGExporter {
  private config: PackingConfig;

  constructor(config: PackingConfig) {
    this.config = config;
  }

  setConfig(config: PackingConfig): void {
    this.config = config;
  }

  getConfig(): PackingConfig {
    return this.config;
  }

  generateSheetSVG(sheet: PackedSheet): string {
    return generatePackedSheetSVG(sheet, this.config);
  }

  downloadSheet(sheet: PackedSheet, filename?: string): void {
    downloadPackedSheet(sheet, this.config, filename);
  }

  async downloadAllSheets(sheets: PackedSheet[], filename?: string): Promise<void> {
    await downloadPackedSheetsZip(sheets, this.config, filename);
  }
}
