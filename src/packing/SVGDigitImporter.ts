import { vec2, Vector2 } from '../types/geometry';
import { StrokeCommand, Stroke, DigitDefinition } from './types';

/**
 * Convert SVG arc to cubic bezier curves
 * Based on the SVG spec's arc endpoint parameterization to center parameterization conversion
 */
function arcToBeziers(
  x1: number, y1: number,  // Start point
  rx: number, ry: number,  // Radii
  phi: number,             // X-axis rotation in degrees
  largeArc: boolean,
  sweep: boolean,
  x2: number, y2: number   // End point
): StrokeCommand[] {
  // Handle degenerate cases
  if (x1 === x2 && y1 === y2) return [];
  if (rx === 0 || ry === 0) {
    return [{ type: 'L', point: vec2(x2, y2) }];
  }

  // Ensure radii are positive
  rx = Math.abs(rx);
  ry = Math.abs(ry);

  // Convert angle to radians
  const phiRad = (phi * Math.PI) / 180;
  const cosPhi = Math.cos(phiRad);
  const sinPhi = Math.sin(phiRad);

  // Step 1: Compute (x1', y1')
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // Step 2: Correct radii if necessary
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const sqrtLambda = Math.sqrt(lambda);
    rx *= sqrtLambda;
    ry *= sqrtLambda;
  }

  // Step 3: Compute (cx', cy')
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;

  let sq = (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / (rx2 * y1p2 + ry2 * x1p2);
  if (sq < 0) sq = 0;
  let coef = Math.sqrt(sq);
  if (largeArc === sweep) coef = -coef;

  const cxp = coef * (rx * y1p) / ry;
  const cyp = coef * -(ry * x1p) / rx;

  // Step 4: Compute (cx, cy) from (cx', cy')
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  // Step 5: Compute theta1 and dtheta
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;

  // Angle between two vectors
  const vectorAngle = (ux: number, uy: number, vx: number, vy: number): number => {
    const sign = ux * vy - uy * vx < 0 ? -1 : 1;
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let angle = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    return sign * angle;
  };

  const theta1 = vectorAngle(1, 0, ux, uy);
  let dtheta = vectorAngle(ux, uy, vx, vy);

  // Adjust dtheta based on sweep flag
  if (!sweep && dtheta > 0) {
    dtheta -= 2 * Math.PI;
  } else if (sweep && dtheta < 0) {
    dtheta += 2 * Math.PI;
  }

  // Split arc into segments of at most 90 degrees
  const segments = Math.ceil(Math.abs(dtheta) / (Math.PI / 2));
  const delta = dtheta / segments;
  const commands: StrokeCommand[] = [];

  // Magic number for cubic bezier approximation of a circular arc
  const t = (4 / 3) * Math.tan(delta / 4);

  let theta = theta1;
  for (let i = 0; i < segments; i++) {
    const cosTheta1 = Math.cos(theta);
    const sinTheta1 = Math.sin(theta);
    const theta2 = theta + delta;
    const cosTheta2 = Math.cos(theta2);
    const sinTheta2 = Math.sin(theta2);

    // Control points in unit circle space
    const ep1x = cosTheta1 - t * sinTheta1;
    const ep1y = sinTheta1 + t * cosTheta1;
    const ep2x = cosTheta2 + t * sinTheta2;
    const ep2y = sinTheta2 - t * cosTheta2;

    // Transform back to original coordinate space
    const transform = (px: number, py: number): Vector2 => {
      const x = rx * px;
      const y = ry * py;
      return vec2(
        cosPhi * x - sinPhi * y + cx,
        sinPhi * x + cosPhi * y + cy
      );
    };

    const c1 = transform(ep1x, ep1y);
    const c2 = transform(ep2x, ep2y);
    const end = transform(cosTheta2, sinTheta2);

    commands.push({
      type: 'C',
      c1,
      c2,
      end,
    });

    theta = theta2;
  }

  return commands;
}

/**
 * Parse a number from a path data string, handling optional sign and decimals
 */
function parseNumber(str: string): number {
  return parseFloat(str);
}

/**
 * Tokenize SVG path data into commands and numbers
 */
function tokenizePath(d: string): string[] {
  const tokens: string[] = [];
  let current = '';

  for (let i = 0; i < d.length; i++) {
    const char = d[i];

    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(char)) {
      // Command character
      if (current.trim()) {
        tokens.push(current.trim());
      }
      tokens.push(char);
      current = '';
    } else if (char === ',' || char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      // Separator
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
    } else if (char === '-' && current.trim() && !/[eE]$/.test(current)) {
      // Negative sign starting new number (but not after exponent)
      if (current.trim()) {
        tokens.push(current.trim());
      }
      current = char;
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens;
}

/**
 * Parse SVG path data string into stroke commands
 */
export function parseSVGPath(d: string): Stroke {
  const tokens = tokenizePath(d);
  const commands: StrokeCommand[] = [];

  let i = 0;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let lastControlX = 0;
  let lastControlY = 0;
  let lastCommand = '';

  const getNumber = (): number => {
    if (i >= tokens.length) throw new Error('Unexpected end of path data');
    return parseNumber(tokens[i++]);
  };

  while (i < tokens.length) {
    let cmd = tokens[i];

    // Check if this is a command letter or implicit continuation
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(cmd)) {
      i++;
    } else {
      // Implicit command continuation
      if (lastCommand === 'M') cmd = 'L';
      else if (lastCommand === 'm') cmd = 'l';
      else cmd = lastCommand;
    }

    switch (cmd) {
      case 'M': {
        currentX = getNumber();
        currentY = getNumber();
        startX = currentX;
        startY = currentY;
        commands.push({ type: 'M', point: vec2(currentX, currentY) });
        lastCommand = 'M';
        break;
      }
      case 'm': {
        currentX += getNumber();
        currentY += getNumber();
        startX = currentX;
        startY = currentY;
        commands.push({ type: 'M', point: vec2(currentX, currentY) });
        lastCommand = 'm';
        break;
      }
      case 'L': {
        currentX = getNumber();
        currentY = getNumber();
        commands.push({ type: 'L', point: vec2(currentX, currentY) });
        lastCommand = 'L';
        break;
      }
      case 'l': {
        currentX += getNumber();
        currentY += getNumber();
        commands.push({ type: 'L', point: vec2(currentX, currentY) });
        lastCommand = 'l';
        break;
      }
      case 'H': {
        currentX = getNumber();
        commands.push({ type: 'L', point: vec2(currentX, currentY) });
        lastCommand = 'H';
        break;
      }
      case 'h': {
        currentX += getNumber();
        commands.push({ type: 'L', point: vec2(currentX, currentY) });
        lastCommand = 'h';
        break;
      }
      case 'V': {
        currentY = getNumber();
        commands.push({ type: 'L', point: vec2(currentX, currentY) });
        lastCommand = 'V';
        break;
      }
      case 'v': {
        currentY += getNumber();
        commands.push({ type: 'L', point: vec2(currentX, currentY) });
        lastCommand = 'v';
        break;
      }
      case 'C': {
        const c1x = getNumber();
        const c1y = getNumber();
        const c2x = getNumber();
        const c2y = getNumber();
        currentX = getNumber();
        currentY = getNumber();
        commands.push({
          type: 'C',
          c1: vec2(c1x, c1y),
          c2: vec2(c2x, c2y),
          end: vec2(currentX, currentY),
        });
        lastControlX = c2x;
        lastControlY = c2y;
        lastCommand = 'C';
        break;
      }
      case 'c': {
        const c1x = currentX + getNumber();
        const c1y = currentY + getNumber();
        const c2x = currentX + getNumber();
        const c2y = currentY + getNumber();
        currentX += getNumber();
        currentY += getNumber();
        commands.push({
          type: 'C',
          c1: vec2(c1x, c1y),
          c2: vec2(c2x, c2y),
          end: vec2(currentX, currentY),
        });
        lastControlX = c2x;
        lastControlY = c2y;
        lastCommand = 'c';
        break;
      }
      case 'S': {
        // Smooth cubic: reflect last control point
        const c1x = 2 * currentX - lastControlX;
        const c1y = 2 * currentY - lastControlY;
        const c2x = getNumber();
        const c2y = getNumber();
        currentX = getNumber();
        currentY = getNumber();
        commands.push({
          type: 'C',
          c1: vec2(c1x, c1y),
          c2: vec2(c2x, c2y),
          end: vec2(currentX, currentY),
        });
        lastControlX = c2x;
        lastControlY = c2y;
        lastCommand = 'S';
        break;
      }
      case 's': {
        const c1x = 2 * currentX - lastControlX;
        const c1y = 2 * currentY - lastControlY;
        const c2x = currentX + getNumber();
        const c2y = currentY + getNumber();
        currentX += getNumber();
        currentY += getNumber();
        commands.push({
          type: 'C',
          c1: vec2(c1x, c1y),
          c2: vec2(c2x, c2y),
          end: vec2(currentX, currentY),
        });
        lastControlX = c2x;
        lastControlY = c2y;
        lastCommand = 's';
        break;
      }
      case 'Q': {
        const cx = getNumber();
        const cy = getNumber();
        currentX = getNumber();
        currentY = getNumber();
        commands.push({
          type: 'Q',
          control: vec2(cx, cy),
          end: vec2(currentX, currentY),
        });
        lastControlX = cx;
        lastControlY = cy;
        lastCommand = 'Q';
        break;
      }
      case 'q': {
        const cx = currentX + getNumber();
        const cy = currentY + getNumber();
        currentX += getNumber();
        currentY += getNumber();
        commands.push({
          type: 'Q',
          control: vec2(cx, cy),
          end: vec2(currentX, currentY),
        });
        lastControlX = cx;
        lastControlY = cy;
        lastCommand = 'q';
        break;
      }
      case 'T': {
        // Smooth quadratic: reflect last control point
        const cx = 2 * currentX - lastControlX;
        const cy = 2 * currentY - lastControlY;
        currentX = getNumber();
        currentY = getNumber();
        commands.push({
          type: 'Q',
          control: vec2(cx, cy),
          end: vec2(currentX, currentY),
        });
        lastControlX = cx;
        lastControlY = cy;
        lastCommand = 'T';
        break;
      }
      case 't': {
        const cx = 2 * currentX - lastControlX;
        const cy = 2 * currentY - lastControlY;
        currentX += getNumber();
        currentY += getNumber();
        commands.push({
          type: 'Q',
          control: vec2(cx, cy),
          end: vec2(currentX, currentY),
        });
        lastControlX = cx;
        lastControlY = cy;
        lastCommand = 't';
        break;
      }
      case 'Z':
      case 'z': {
        // Close path - line back to start
        if (currentX !== startX || currentY !== startY) {
          commands.push({ type: 'L', point: vec2(startX, startY) });
        }
        currentX = startX;
        currentY = startY;
        lastCommand = 'Z';
        break;
      }
      case 'A':
      case 'a': {
        // Arc command - convert to cubic bezier curves
        const rx = getNumber();
        const ry = getNumber();
        const xAxisRotation = getNumber();
        const largeArcFlag = getNumber() !== 0;
        const sweepFlag = getNumber() !== 0;
        let endX: number, endY: number;
        if (cmd === 'A') {
          endX = getNumber();
          endY = getNumber();
        } else {
          endX = currentX + getNumber();
          endY = currentY + getNumber();
        }

        const arcCommands = arcToBeziers(
          currentX, currentY,
          rx, ry,
          xAxisRotation,
          largeArcFlag,
          sweepFlag,
          endX, endY
        );
        commands.push(...arcCommands);

        currentX = endX;
        currentY = endY;
        lastCommand = cmd;
        break;
      }
      default:
        throw new Error(`Unknown path command: ${cmd}`);
    }

    // Reset control point for commands that don't set it
    if (!['C', 'c', 'S', 's', 'Q', 'q', 'T', 't'].includes(cmd)) {
      lastControlX = currentX;
      lastControlY = currentY;
    }
  }

  return commands;
}

/**
 * Parse an SVG string and extract all path definitions
 */
export function parseSVGString(svgContent: string): { paths: Stroke[]; viewBox: { width: number; height: number } } {
  // Extract viewBox
  const viewBoxMatch = svgContent.match(/viewBox\s*=\s*["']([^"']+)["']/);
  let viewBoxWidth = 60;
  let viewBoxHeight = 100;

  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4) {
      viewBoxWidth = parts[2];
      viewBoxHeight = parts[3];
    }
  }

  // Extract all path elements that have stroke defined
  const paths: Stroke[] = [];
  const pathRegex = /<path([^>]*)\/?>(?:<\/path>)?/gi;
  let match;

  while ((match = pathRegex.exec(svgContent)) !== null) {
    const pathAttrs = match[1];

    // Check if path has stroke attribute (either stroke="..." or in style="...stroke:...")
    const hasStroke = /\bstroke\s*[:=]/i.test(pathAttrs);
    if (!hasStroke) {
      continue; // Skip paths without stroke
    }

    // Extract d attribute
    const dMatch = pathAttrs.match(/\bd\s*=\s*["']([^"']+)["']/);
    if (!dMatch) {
      continue;
    }

    try {
      const stroke = parseSVGPath(dMatch[1]);
      if (stroke.length > 0) {
        paths.push(stroke);
      }
    } catch (e) {
      console.warn('Failed to parse path:', e);
    }
  }

  return { paths, viewBox: { width: viewBoxWidth, height: viewBoxHeight } };
}

/**
 * Normalize a stroke to unit coordinates (height = 1)
 */
function normalizeStroke(stroke: Stroke, _viewBoxWidth: number, viewBoxHeight: number): Stroke {
  const scale = 1 / viewBoxHeight;

  const transformPoint = (p: Vector2): Vector2 => {
    return vec2(p.x * scale, p.y * scale);
  };

  return stroke.map(cmd => {
    switch (cmd.type) {
      case 'M':
        return { type: 'M', point: transformPoint(cmd.point) };
      case 'L':
        return { type: 'L', point: transformPoint(cmd.point) };
      case 'Q':
        return {
          type: 'Q',
          control: transformPoint(cmd.control),
          end: transformPoint(cmd.end),
        };
      case 'C':
        return {
          type: 'C',
          c1: transformPoint(cmd.c1),
          c2: transformPoint(cmd.c2),
          end: transformPoint(cmd.end),
        };
    }
  });
}

/**
 * Import a digit definition from SVG content string
 * Returns normalized strokes (height = 1, Y flipped) and the width
 */
export function importDigitFromSVG(svgContent: string): { strokes: DigitDefinition; width: number } {
  const { paths, viewBox } = parseSVGString(svgContent);

  const normalizedPaths = paths.map(path =>
    normalizeStroke(path, viewBox.width, viewBox.height)
  );

  const width = viewBox.width / viewBox.height;

  return { strokes: normalizedPaths, width };
}

/**
 * Import all digits from an array of SVG content strings
 */
export function importAllDigits(svgContents: string[]): { digits: DigitDefinition[]; widths: number[] } {
  const digits: DigitDefinition[] = [];
  const widths: number[] = [];

  for (const svg of svgContents) {
    const { strokes, width } = importDigitFromSVG(svg);
    digits.push(strokes);
    widths.push(width);
  }

  return { digits, widths };
}
