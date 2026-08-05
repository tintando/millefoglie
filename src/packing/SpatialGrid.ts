import { BoundingBox2D, PlacedPiece } from './types';

/**
 * A spatial grid index for efficient collision detection.
 * Divides the packing area into cells and tracks which pieces occupy which cells.
 */
export interface SpatialGrid {
  cellSize: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  cells: Map<string, Set<PlacedPiece>>;
}

/**
 * Create a cell key from column and row indices
 */
function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/**
 * Create a new spatial grid
 * @param width Total width of the packing area
 * @param height Total height of the packing area
 * @param cellSize Size of each grid cell (larger = fewer cells but more pieces per cell)
 */
export function createGrid(width: number, height: number, cellSize: number): SpatialGrid {
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);

  return {
    cellSize,
    width,
    height,
    cols,
    rows,
    cells: new Map(),
  };
}

/**
 * Get the cell indices that a bounding box overlaps
 */
function getCellRange(grid: SpatialGrid, bb: BoundingBox2D): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
  const minCol = Math.max(0, Math.floor(bb.minX / grid.cellSize));
  const maxCol = Math.min(grid.cols - 1, Math.floor(bb.maxX / grid.cellSize));
  const minRow = Math.max(0, Math.floor(bb.minY / grid.cellSize));
  const maxRow = Math.min(grid.rows - 1, Math.floor(bb.maxY / grid.cellSize));

  return { minCol, maxCol, minRow, maxRow };
}

/**
 * Insert a piece into the spatial grid
 * @param grid The spatial grid
 * @param piece The placed piece to insert
 * @param bb The bounding box of the piece (pre-computed for efficiency)
 */
export function insertPiece(grid: SpatialGrid, piece: PlacedPiece, bb: BoundingBox2D): void {
  const { minCol, maxCol, minRow, maxRow } = getCellRange(grid, bb);

  for (let col = minCol; col <= maxCol; col++) {
    for (let row = minRow; row <= maxRow; row++) {
      const key = cellKey(col, row);
      let cell = grid.cells.get(key);
      if (!cell) {
        cell = new Set();
        grid.cells.set(key, cell);
      }
      cell.add(piece);
    }
  }
}

/**
 * Remove a piece from the spatial grid
 * @param grid The spatial grid
 * @param piece The placed piece to remove
 * @param bb The bounding box of the piece
 */
export function removePiece(grid: SpatialGrid, piece: PlacedPiece, bb: BoundingBox2D): void {
  const { minCol, maxCol, minRow, maxRow } = getCellRange(grid, bb);

  for (let col = minCol; col <= maxCol; col++) {
    for (let row = minRow; row <= maxRow; row++) {
      const key = cellKey(col, row);
      const cell = grid.cells.get(key);
      if (cell) {
        cell.delete(piece);
        if (cell.size === 0) {
          grid.cells.delete(key);
        }
      }
    }
  }
}

/**
 * Query all pieces that might overlap with a given bounding box.
 * Returns a unique set of pieces from all overlapping cells.
 * @param grid The spatial grid
 * @param bb The bounding box to query
 * @param spacing Optional additional spacing to expand the query area
 */
export function queryNearby(grid: SpatialGrid, bb: BoundingBox2D, spacing: number = 0): PlacedPiece[] {
  // Expand the query bounding box by the spacing
  const expandedBB: BoundingBox2D = {
    minX: bb.minX - spacing,
    maxX: bb.maxX + spacing,
    minY: bb.minY - spacing,
    maxY: bb.maxY + spacing,
  };

  const { minCol, maxCol, minRow, maxRow } = getCellRange(grid, expandedBB);
  const result = new Set<PlacedPiece>();

  for (let col = minCol; col <= maxCol; col++) {
    for (let row = minRow; row <= maxRow; row++) {
      const key = cellKey(col, row);
      const cell = grid.cells.get(key);
      if (cell) {
        for (const piece of cell) {
          result.add(piece);
        }
      }
    }
  }

  return Array.from(result);
}

/**
 * Clear all pieces from the grid
 */
export function clearGrid(grid: SpatialGrid): void {
  grid.cells.clear();
}

/**
 * Get the number of pieces in the grid (for debugging)
 */
export function getGridStats(grid: SpatialGrid): { cellCount: number; totalEntries: number } {
  let totalEntries = 0;
  for (const cell of grid.cells.values()) {
    totalEntries += cell.size;
  }
  return {
    cellCount: grid.cells.size,
    totalEntries,
  };
}
