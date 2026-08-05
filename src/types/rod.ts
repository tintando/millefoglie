import { Vector2 } from './geometry';

/**
 * Link between the two rods placed together in symmetry mode. Both rods carry
 * one, pointing at each other, so editing either end keeps the pair mirrored.
 *
 * The mirror line is stored with the rod rather than read from the model
 * centre at edit time: the centre can move (a new model, a reloaded project)
 * and the pair should stay symmetric about the line it was created on.
 */
export interface RodMirror {
  partnerId: string;  // The rod on the other side of the mirror line
  axis: 'x' | 'y';    // Symmetry axis, as chosen in the placement UI
  center: number;     // Mirror line: axis 'x' reflects Y about it, 'y' reflects X
}

export interface AlignmentRod {
  id: string;
  position: Vector2;  // X, Y position of the rod
  diameter: number;   // Diameter in mm
  bottomZ: number;    // Bottom Z position (relative to model, 0 = model bottom)
  topZ: number;       // Top Z position (relative to model, 1 = model top)
  hidden?: boolean;   // Temporarily hide rod body in 3D view
  mirror?: RodMirror; // Set on both rods of a symmetric pair
}

/** Reflects a coordinate across a mirror line. */
export function reflect(value: number, center: number): number {
  return 2 * center - value;
}

export interface RodIntersection {
  rodId: string;
  layerIndices: number[];  // Which layers the rod intersects with the model
  continuousSections: ContinuousSection[];
}

export interface ContinuousSection {
  startLayer: number;
  endLayer: number;
}

export function generateRodId(): string {
  return 'rod_' + Math.random().toString(36).substring(2, 9);
}

export function createRod(x: number, y: number, diameter: number, bottomZ: number = 0, topZ: number = 1): AlignmentRod {
  return {
    id: generateRodId(),
    position: { x, y },
    diameter,
    bottomZ,
    topZ,
  };
}
