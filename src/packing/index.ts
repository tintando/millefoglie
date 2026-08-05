// Types
export type {
  BoundingBox2D,
  PackablePiece,
  PlacedPiece,
  PackedSheet,
  PackingConfig,
  PackingResult,
  StrokeCommand,
  Stroke,
  DigitDefinition,
} from './types';

export { DEFAULT_PACKING_CONFIG } from './types';

// Single-stroke font
export {
  getDigitStrokes,
  getDigitWidth,
  generateNumber,
  generateNumberRotated,
  getNumberBoundingBox,
  strokeAsPoints,
  generateNumberAsPolylines,
  initializeFonts,
  initializeFontsFromData,
  fontsInitialized,
} from './SingleStrokeFont';

// Bezier utilities
export {
  transformCommand,
  transformStroke,
  strokeBoundingBox,
  getCommandEndpoint,
  strokeToPoints,
} from './bezierUtils';

// SVG digit importer
export {
  parseSVGPath,
  parseSVGString,
  importDigitFromSVG,
  importAllDigits,
} from './SVGDigitImporter';

// Piece extraction
export {
  extractPiecesFromSlice,
  extractPiecesFromSlices,
  translatePiece,
  rotatePiece,
  getRotatedBoundingBox,
} from './PieceExtractor';

// Packing algorithm
export {
  packPieces,
  packPiecesWithProgress,
  getSheetBoundingBox,
} from './Packer';

// Worker client
export { PackerWorkerClient } from './PackerWorkerClient';

// Spatial grid (for advanced usage)
export type { SpatialGrid } from './SpatialGrid';
export {
  createGrid,
  insertPiece,
  removePiece,
  queryNearby,
  clearGrid,
  getGridStats,
} from './SpatialGrid';

// SVG export
export {
  generatePackedSheetSVG,
  generateAllPackedSheetsSVG,
  downloadPackedSheet,
  downloadPackedSheetsZip,
  PackedSVGExporter,
} from './PackedSVGExporter';
