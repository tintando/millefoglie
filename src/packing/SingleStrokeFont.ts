import { Vector2, vec2 } from '../types/geometry';
import { Stroke, DigitDefinition } from './types';
import { transformStroke, strokeToPoints } from './bezierUtils';
import { importDigitFromSVG } from './SVGDigitImporter';

// Spacing between digits (unit coordinates)
const DIGIT_SPACING = 0.15;

// Font data storage - will be initialized by the appropriate loader
let DIGIT_STROKES: DigitDefinition[] | null = null;
let DIGIT_WIDTHS: number[] | null = null;

/**
 * Initialize font data from SVG content strings.
 * Call this before using any font functions.
 */
export function initializeFonts(svgContents: string[]): void {
  const parsedDigits = svgContents.map(svg => importDigitFromSVG(svg));
  DIGIT_STROKES = parsedDigits.map(d => d.strokes);
  DIGIT_WIDTHS = parsedDigits.map(d => d.width);
}

/**
 * Initialize font data from pre-parsed digit definitions.
 * Alternative to initializeFonts() when fonts are already parsed.
 */
export function initializeFontsFromData(digits: DigitDefinition[], widths: number[]): void {
  DIGIT_STROKES = digits;
  DIGIT_WIDTHS = widths;
}

/**
 * Check if fonts have been initialized.
 */
export function fontsInitialized(): boolean {
  return DIGIT_STROKES !== null && DIGIT_WIDTHS !== null;
}

/**
 * Ensure fonts are loaded, throwing if not.
 */
function ensureFontsLoaded(): void {
  if (!DIGIT_STROKES || !DIGIT_WIDTHS) {
    throw new Error('Fonts not initialized. Call initializeFonts() or initializeFontsFromData() first.');
  }
}

/**
 * Get the strokes for a single digit (as bezier commands)
 */
export function getDigitStrokes(digit: number): Stroke[] {
  ensureFontsLoaded();
  if (digit < 0 || digit > 9) {
    throw new Error(`Invalid digit: ${digit}`);
  }
  return DIGIT_STROKES![digit];
}

/**
 * Get the width of a digit (unit coordinates, height=1)
 */
export function getDigitWidth(digit: number): number {
  ensureFontsLoaded();
  return DIGIT_WIDTHS![digit];
}

/**
 * Generate strokes for a multi-digit number (as bezier commands)
 * @param n The number to render
 * @param position Center position of the number
 * @param height Height of the digits in final units
 * @returns Array of strokes (each stroke is an array of commands)
 */
export function generateNumber(n: number, position: Vector2, height: number): Stroke[] {
  ensureFontsLoaded();
  const digits = String(Math.abs(Math.floor(n))).split('').map(Number);

  // Calculate total width
  let totalWidth = 0;
  for (let i = 0; i < digits.length; i++) {
    totalWidth += getDigitWidth(digits[i]);
    if (i < digits.length - 1) {
      totalWidth += DIGIT_SPACING;
    }
  }

  // Scale from unit coordinates to final size
  const scale = height;
  const scaledWidth = totalWidth * scale;

  // Start position (centered on position)
  let currentX = position.x - scaledWidth / 2;
  const baseY = position.y - height / 2;

  const result: Stroke[] = [];

  for (let i = 0; i < digits.length; i++) {
    const digit = digits[i];
    const strokes = DIGIT_STROKES![digit];

    for (const stroke of strokes) {
      const transformedStroke = transformStroke(
        stroke,
        scale,
        vec2(currentX, baseY)
      );
      result.push(transformedStroke);
    }

    currentX += getDigitWidth(digit) * scale;
    if (i < digits.length - 1) {
      currentX += DIGIT_SPACING * scale;
    }
  }

  return result;
}

/**
 * Generate strokes for a number with rotation (as bezier commands)
 * @param n The number to render
 * @param position Center position of the number
 * @param height Height of the digits
 * @param rotation Rotation in radians
 */
export function generateNumberRotated(
  n: number,
  position: Vector2,
  height: number,
  rotation: number
): Stroke[] {
  // Generate at origin first
  const strokes = generateNumber(n, vec2(0, 0), height);

  // Apply rotation and translation to each stroke
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const rotatePoint = (p: Vector2): Vector2 => vec2(
    position.x + p.x * cos - p.y * sin,
    position.y + p.x * sin + p.y * cos
  );

  return strokes.map(stroke =>
    stroke.map(cmd => {
      switch (cmd.type) {
        case 'M':
          return { type: 'M', point: rotatePoint(cmd.point) };
        case 'L':
          return { type: 'L', point: rotatePoint(cmd.point) };
        case 'Q':
          return {
            type: 'Q',
            control: rotatePoint(cmd.control),
            end: rotatePoint(cmd.end),
          };
        case 'C':
          return {
            type: 'C',
            c1: rotatePoint(cmd.c1),
            c2: rotatePoint(cmd.c2),
            end: rotatePoint(cmd.end),
          };
      }
    })
  );
}

/**
 * Get the bounding box of a number (for collision detection)
 */
export function getNumberBoundingBox(n: number, height: number): { width: number; height: number } {
  ensureFontsLoaded();
  const digits = String(Math.abs(Math.floor(n))).split('').map(Number);

  let totalWidth = 0;
  for (let i = 0; i < digits.length; i++) {
    totalWidth += getDigitWidth(digits[i]);
    if (i < digits.length - 1) {
      totalWidth += DIGIT_SPACING;
    }
  }

  return {
    width: totalWidth * height,
    height: height,
  };
}

/**
 * Convert a stroke (bezier commands) to an array of points
 * Useful for compatibility with legacy code expecting Vector2[]
 */
export function strokeAsPoints(stroke: Stroke, samplesPerCurve: number = 10): Vector2[] {
  return strokeToPoints(stroke, samplesPerCurve);
}

/**
 * Generate strokes as polylines (for backward compatibility)
 * @deprecated Use generateNumber() with bezier commands instead
 */
export function generateNumberAsPolylines(
  n: number,
  position: Vector2,
  height: number,
  samplesPerCurve: number = 10
): Vector2[][] {
  const strokes = generateNumber(n, position, height);
  return strokes.map(stroke => strokeToPoints(stroke, samplesPerCurve));
}
