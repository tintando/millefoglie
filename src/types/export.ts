export interface PaperSize {
  name: string;
  width: number;  // mm
  height: number; // mm
}

export const PAPER_SIZES: Record<string, PaperSize> = {
  a4: { name: 'A4', width: 210, height: 297 },
  a3: { name: 'A3', width: 297, height: 420 },
  custom: { name: 'Custom', width: 210, height: 297 }, // Default values for custom
};

export interface ExportConfig {
  paperSize: PaperSize;
  scale: number;
  showLabelCut: boolean;
  margin: number; // mm
  strokeWidth: number; // mm
}

export interface PackingExportConfig {
  pieceSpacing: number;      // Gap between pieces (mm)
  rotationSteps: number;     // Number of angles to try (e.g., 12 = every 30°)
  numberHeight: number;      // Height of layer numbers (mm)
  fastMode: boolean;         // Use AABB-only collision (faster but less efficient packing)
}

export const DEFAULT_PACKING_EXPORT_CONFIG: PackingExportConfig = {
  pieceSpacing: 2,           // 2mm between pieces
  rotationSteps: 12,         // Every 30 degrees
  numberHeight: 5,           // 5mm tall numbers
  fastMode: false,           // Use precise polygon collision by default
};

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  paperSize: PAPER_SIZES.a4,
  scale: 1,
  showLabelCut: true,
  margin: 10,
  strokeWidth: 0.2,
};

export interface ExportProgress {
  current: number;
  total: number;
  message: string;
}

export type ExportProgressCallback = (progress: ExportProgress) => void;
