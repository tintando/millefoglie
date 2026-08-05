import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importDigitFromSVG } from '../../src/packing/SVGDigitImporter';
import { DigitDefinition } from '../../src/packing/types';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the digits folder
const DIGITS_DIR = path.resolve(__dirname, '../../src/packing/fonts/digits');

/**
 * Load all digit SVG files from disk and parse them.
 * This is the Node.js equivalent of the Vite ?raw imports.
 */
export function loadDigitFonts(): { digits: DigitDefinition[]; widths: number[] } {
  const digits: DigitDefinition[] = [];
  const widths: number[] = [];

  for (let i = 0; i <= 9; i++) {
    const svgPath = path.join(DIGITS_DIR, `digit-${i}.svg`);
    const svgContent = fs.readFileSync(svgPath, 'utf-8');
    const { strokes, width } = importDigitFromSVG(svgContent);
    digits.push(strokes);
    widths.push(width);
  }

  return { digits, widths };
}

// Cache the loaded fonts
let cachedFonts: { digits: DigitDefinition[]; widths: number[] } | null = null;

/**
 * Get digit fonts, loading from disk if not already cached.
 */
export function getDigitFonts(): { digits: DigitDefinition[]; widths: number[] } {
  if (!cachedFonts) {
    cachedFonts = loadDigitFonts();
  }
  return cachedFonts;
}
