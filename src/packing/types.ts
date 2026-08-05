import { Vector2 } from '../types/geometry';

// Stroke command types for bezier curve support
export type StrokeCommand =
  | { type: 'M'; point: Vector2 }                              // Move to
  | { type: 'L'; point: Vector2 }                              // Line to
  | { type: 'Q'; control: Vector2; end: Vector2 }              // Quadratic bezier
  | { type: 'C'; c1: Vector2; c2: Vector2; end: Vector2 };     // Cubic bezier

// A stroke is a sequence of commands
export type Stroke = StrokeCommand[];

// A digit definition has multiple strokes
export type DigitDefinition = Stroke[];

export interface BoundingBox2D {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// A piece ready for packing
export interface PackablePiece {
  id: string;
  layerIndex: number;
  outerContour: Vector2[];
  holes: Vector2[][];        // Including rod holes as polygons
  boundingBox: BoundingBox2D;
  area: number;
  centroid: Vector2;
}

// A piece placed on a sheet
export interface PlacedPiece {
  piece: PackablePiece;
  x: number;
  y: number;
  rotation: number;          // Radians
}

// A paper sheet with placed pieces
export interface PackedSheet {
  index: number;
  pieces: PlacedPiece[];
  utilization: number;       // 0-1
}

// Packing configuration
export interface PackingConfig {
  paperWidth: number;        // Usable area after margins
  paperHeight: number;
  pieceSpacing: number;      // Gap between pieces (mm)
  rotationSteps: number;     // Number of angles to try (e.g., 12 = every 30°)
  numberHeight: number;      // Height of layer numbers (mm)
  margin: number;            // Margin from paper edge (mm)
  strokeWidth: number;       // Stroke width for cutting (mm)
  showLabelCut: boolean;     // Whether to add cuttable layer numbers
  fastMode: boolean;         // Use AABB-only collision (faster but less efficient packing)
}

// Result of packing operation
export interface PackingResult {
  sheets: PackedSheet[];
  totalPieces: number;
  unplacedPieces: PackablePiece[];
}

export const DEFAULT_PACKING_CONFIG: PackingConfig = {
  paperWidth: 210,           // A4 width
  paperHeight: 297,          // A4 height
  pieceSpacing: 2,           // 2mm between pieces
  rotationSteps: 12,         // Every 30 degrees
  numberHeight: 5,           // 5mm tall numbers
  margin: 10,                // 10mm margin
  strokeWidth: 0.2,          // 0.2mm stroke
  showLabelCut: true,        // Add cuttable layer numbers
  fastMode: false,           // Use precise polygon collision by default
};
