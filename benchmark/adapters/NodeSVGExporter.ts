import * as fs from 'node:fs';
import * as path from 'node:path';
import { PackedSheet, PackingConfig } from '../../src/packing/types';
import { generatePackedSheetSVG } from '../../src/packing/PackedSVGExporter';

/**
 * Save a packed sheet as an SVG file to the filesystem.
 */
export function savePackedSheetSVG(
  sheet: PackedSheet,
  config: PackingConfig,
  outputDir: string,
  filename?: string
): string {
  const svg = generatePackedSheetSVG(sheet, config);
  const name = filename || `packed_sheet_${String(sheet.index + 1).padStart(3, '0')}.svg`;
  const outputPath = path.join(outputDir, name);

  fs.writeFileSync(outputPath, svg, 'utf-8');

  return outputPath;
}

/**
 * Save all packed sheets as SVG files.
 * Returns array of saved file paths.
 */
export function saveAllPackedSheetsSVG(
  sheets: PackedSheet[],
  config: PackingConfig,
  outputDir: string
): string[] {
  const savedPaths: string[] = [];

  for (const sheet of sheets) {
    const savedPath = savePackedSheetSVG(sheet, config, outputDir);
    savedPaths.push(savedPath);
  }

  return savedPaths;
}
