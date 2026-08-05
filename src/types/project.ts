import { Vector3, BoundingBox } from './geometry';
import { AlignmentRod } from './rod';

export interface ProjectModel {
  vertices: Vector3[];
  triangles: number[][];
  boundingBox: BoundingBox;
}

export interface ProjectSliceConfig {
  thickness: number;
}

export interface ProjectExportConfig {
  paperSize: string;           // 'a4', 'a3', or 'custom'
  customPaperWidth?: number;   // Only when paperSize is 'custom'
  customPaperHeight?: number;  // Only when paperSize is 'custom'
  scale: number;
  showLabelCut: boolean;
}

export interface ProjectPackingConfig {
  pieceSpacing: number;
  numberHeight: number;
  fastMode: boolean;
}

export interface ProjectUIState {
  showFloating: boolean;
  rodDiameter: number;
  currentLayer: number;
}

export interface MillefoglieProject {
  formatVersion: string;           // "1.0"
  createdAt: string;               // ISO timestamp
  model: ProjectModel;
  rods: AlignmentRod[];
  sliceConfig: ProjectSliceConfig;
  exportConfig: ProjectExportConfig;
  packingConfig: ProjectPackingConfig;
  uiState: ProjectUIState;
}

export const PROJECT_FORMAT_VERSION = '1.0';
export const PROJECT_FILE_EXTENSION = '.mfp';
