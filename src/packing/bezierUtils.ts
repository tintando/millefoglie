import { Vector2, vec2 } from '../types/geometry';
import { StrokeCommand, Stroke, BoundingBox2D } from './types';

/**
 * Transform a single stroke command (apply scale, translate, rotate)
 */
export function transformCommand(
  cmd: StrokeCommand,
  scale: number,
  translate: Vector2,
  rotation: number = 0,
  rotationCenter: Vector2 = vec2(0, 0)
): StrokeCommand {
  const transformPoint = (p: Vector2): Vector2 => {
    // Scale first
    let x = p.x * scale;
    let y = p.y * scale;

    // Rotate around center
    if (rotation !== 0) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const cx = rotationCenter.x;
      const cy = rotationCenter.y;
      const dx = x - cx;
      const dy = y - cy;
      x = cx + dx * cos - dy * sin;
      y = cy + dx * sin + dy * cos;
    }

    // Translate
    return vec2(x + translate.x, y + translate.y);
  };

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
}

/**
 * Transform an entire stroke
 */
export function transformStroke(
  stroke: Stroke,
  scale: number,
  translate: Vector2,
  rotation: number = 0,
  rotationCenter: Vector2 = vec2(0, 0)
): Stroke {
  return stroke.map(cmd => transformCommand(cmd, scale, translate, rotation, rotationCenter));
}

/**
 * Get bounding box for a quadratic bezier curve
 */
function quadraticBezierBounds(p0: Vector2, p1: Vector2, p2: Vector2): BoundingBox2D {
  // Start with endpoints
  let minX = Math.min(p0.x, p2.x);
  let maxX = Math.max(p0.x, p2.x);
  let minY = Math.min(p0.y, p2.y);
  let maxY = Math.max(p0.y, p2.y);

  // Check for extrema: t = (p0 - p1) / (p0 - 2*p1 + p2)
  const checkAxis = (v0: number, v1: number, v2: number): [number, number] => {
    let min = Math.min(v0, v2);
    let max = Math.max(v0, v2);

    const denom = v0 - 2 * v1 + v2;
    if (Math.abs(denom) > 1e-10) {
      const t = (v0 - v1) / denom;
      if (t > 0 && t < 1) {
        // Quadratic bezier at t: (1-t)^2*p0 + 2*(1-t)*t*p1 + t^2*p2
        const mt = 1 - t;
        const val = mt * mt * v0 + 2 * mt * t * v1 + t * t * v2;
        min = Math.min(min, val);
        max = Math.max(max, val);
      }
    }
    return [min, max];
  };

  [minX, maxX] = checkAxis(p0.x, p1.x, p2.x);
  [minY, maxY] = checkAxis(p0.y, p1.y, p2.y);

  return { minX, maxX, minY, maxY };
}

/**
 * Get bounding box for a cubic bezier curve
 */
function cubicBezierBounds(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2): BoundingBox2D {
  // Start with endpoints
  let minX = Math.min(p0.x, p3.x);
  let maxX = Math.max(p0.x, p3.x);
  let minY = Math.min(p0.y, p3.y);
  let maxY = Math.max(p0.y, p3.y);

  // Find extrema by solving derivative = 0
  const checkAxis = (v0: number, v1: number, v2: number, v3: number): [number, number] => {
    let min = Math.min(v0, v3);
    let max = Math.max(v0, v3);

    // Derivative coefficients: 3*(-v0 + 3*v1 - 3*v2 + v3)*t^2 + 6*(v0 - 2*v1 + v2)*t + 3*(-v0 + v1)
    const a = -v0 + 3 * v1 - 3 * v2 + v3;
    const b = v0 - 2 * v1 + v2;
    const c = -v0 + v1;

    // Solve quadratic: a*t^2 + 2*b*t + c = 0
    if (Math.abs(a) > 1e-10) {
      const discriminant = b * b - a * c;
      if (discriminant >= 0) {
        const sqrtD = Math.sqrt(discriminant);
        const t1 = (-b - sqrtD) / a;
        const t2 = (-b + sqrtD) / a;

        for (const t of [t1, t2]) {
          if (t > 0 && t < 1) {
            const mt = 1 - t;
            const val = mt * mt * mt * v0 + 3 * mt * mt * t * v1 + 3 * mt * t * t * v2 + t * t * t * v3;
            min = Math.min(min, val);
            max = Math.max(max, val);
          }
        }
      }
    } else if (Math.abs(b) > 1e-10) {
      // Linear: 2*b*t + c = 0
      const t = -c / (2 * b);
      if (t > 0 && t < 1) {
        const mt = 1 - t;
        const val = mt * mt * mt * v0 + 3 * mt * mt * t * v1 + 3 * mt * t * t * v2 + t * t * t * v3;
        min = Math.min(min, val);
        max = Math.max(max, val);
      }
    }

    return [min, max];
  };

  [minX, maxX] = checkAxis(p0.x, p1.x, p2.x, p3.x);
  [minY, maxY] = checkAxis(p0.y, p1.y, p2.y, p3.y);

  return { minX, maxX, minY, maxY };
}

/**
 * Calculate bounding box for a stroke (sequence of commands)
 */
export function strokeBoundingBox(stroke: Stroke): BoundingBox2D {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  let currentPos = vec2(0, 0);

  const expandBounds = (box: BoundingBox2D) => {
    minX = Math.min(minX, box.minX);
    maxX = Math.max(maxX, box.maxX);
    minY = Math.min(minY, box.minY);
    maxY = Math.max(maxY, box.maxY);
  };

  const expandPoint = (p: Vector2) => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  };

  for (const cmd of stroke) {
    switch (cmd.type) {
      case 'M':
        expandPoint(cmd.point);
        currentPos = cmd.point;
        break;
      case 'L':
        expandPoint(cmd.point);
        currentPos = cmd.point;
        break;
      case 'Q':
        expandBounds(quadraticBezierBounds(currentPos, cmd.control, cmd.end));
        currentPos = cmd.end;
        break;
      case 'C':
        expandBounds(cubicBezierBounds(currentPos, cmd.c1, cmd.c2, cmd.end));
        currentPos = cmd.end;
        break;
    }
  }

  return { minX, maxX, minY, maxY };
}

/**
 * Get the endpoint of a stroke command
 */
export function getCommandEndpoint(cmd: StrokeCommand): Vector2 {
  switch (cmd.type) {
    case 'M':
    case 'L':
      return cmd.point;
    case 'Q':
      return cmd.end;
    case 'C':
      return cmd.end;
  }
}

/**
 * Convert a stroke to an array of points by sampling bezier curves
 */
export function strokeToPoints(stroke: Stroke, samplesPerCurve: number = 10): Vector2[] {
  const points: Vector2[] = [];
  let currentPos = vec2(0, 0);

  for (const cmd of stroke) {
    switch (cmd.type) {
      case 'M':
        points.push(cmd.point);
        currentPos = cmd.point;
        break;
      case 'L':
        points.push(cmd.point);
        currentPos = cmd.point;
        break;
      case 'Q':
        // Sample quadratic bezier
        for (let i = 1; i <= samplesPerCurve; i++) {
          const t = i / samplesPerCurve;
          const mt = 1 - t;
          const x = mt * mt * currentPos.x + 2 * mt * t * cmd.control.x + t * t * cmd.end.x;
          const y = mt * mt * currentPos.y + 2 * mt * t * cmd.control.y + t * t * cmd.end.y;
          points.push(vec2(x, y));
        }
        currentPos = cmd.end;
        break;
      case 'C':
        // Sample cubic bezier
        for (let i = 1; i <= samplesPerCurve; i++) {
          const t = i / samplesPerCurve;
          const mt = 1 - t;
          const x = mt * mt * mt * currentPos.x + 3 * mt * mt * t * cmd.c1.x +
                    3 * mt * t * t * cmd.c2.x + t * t * t * cmd.end.x;
          const y = mt * mt * mt * currentPos.y + 3 * mt * mt * t * cmd.c1.y +
                    3 * mt * t * t * cmd.c2.y + t * t * t * cmd.end.y;
          points.push(vec2(x, y));
        }
        currentPos = cmd.end;
        break;
    }
  }

  return points;
}
