import JSZip from 'jszip';
import {
  MillefoglieProject,
  ProjectModel,
  ProjectSliceConfig,
  ProjectExportConfig,
  ProjectPackingConfig,
  ProjectUIState,
  PROJECT_FORMAT_VERSION,
} from '../types/project';
import { IndexedMesh, computeBoundingBox } from '../types/geometry';
import { AlignmentRod } from '../types/rod';

// Threshold for compression (1MB)
const COMPRESSION_THRESHOLD = 1024 * 1024;

export interface ProjectState {
  model: IndexedMesh;
  rods: AlignmentRod[];
  sliceConfig: ProjectSliceConfig;
  exportConfig: ProjectExportConfig;
  packingConfig: ProjectPackingConfig;
  uiState: ProjectUIState;
}

/**
 * Creates a project object from the current application state
 */
export function createProject(state: ProjectState): MillefoglieProject {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    model: {
      vertices: state.model.vertices,
      triangles: state.model.triangles,
      boundingBox: state.model.boundingBox,
    },
    rods: state.rods.map(rod => ({
      id: rod.id,
      position: { x: rod.position.x, y: rod.position.y },
      diameter: rod.diameter,
      bottomZ: rod.bottomZ,
      topZ: rod.topZ,
      hidden: rod.hidden,
      // Keeps symmetric pairs linked across a save/load round trip
      mirror: rod.mirror ? { ...rod.mirror } : undefined,
    })),
    sliceConfig: state.sliceConfig,
    exportConfig: state.exportConfig,
    packingConfig: state.packingConfig,
    uiState: state.uiState,
  };
}

/**
 * Serializes and downloads a project as a .mfp file
 * Uses compression if the file is larger than 1MB
 */
export async function saveProject(project: MillefoglieProject, filename: string = 'project.mfp'): Promise<void> {
  const jsonString = JSON.stringify(project);
  const size = new Blob([jsonString]).size;

  let blob: Blob;

  if (size > COMPRESSION_THRESHOLD) {
    // Compress with JSZip
    const zip = new JSZip();
    zip.file('project.json', jsonString);
    const compressed = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    blob = compressed;
  } else {
    // Save as plain JSON
    blob = new Blob([jsonString], { type: 'application/json' });
  }

  // Trigger download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.mfp') ? filename : `${filename}.mfp`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parses a .mfp file and returns the project data
 * Handles both compressed and uncompressed formats
 */
export async function loadProject(file: File): Promise<MillefoglieProject> {
  const arrayBuffer = await file.arrayBuffer();

  let jsonString: string;

  // Try to detect if it's a ZIP file by checking magic bytes (PK signature)
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
    // ZIP file (compressed)
    const zip = await JSZip.loadAsync(arrayBuffer);
    const projectFile = zip.file('project.json');
    if (!projectFile) {
      throw new Error('Invalid project file: missing project.json');
    }
    jsonString = await projectFile.async('string');
  } else {
    // Plain JSON
    jsonString = new TextDecoder().decode(arrayBuffer);
  }

  const project = JSON.parse(jsonString) as MillefoglieProject;

  // Validate and migrate if needed
  validateAndMigrateProject(project);

  return project;
}

/**
 * Validates project structure and migrates older versions if needed
 */
function validateAndMigrateProject(project: MillefoglieProject): void {
  if (!project.formatVersion) {
    throw new Error('Invalid project file: missing format version');
  }

  if (!project.model || !project.model.vertices || !project.model.triangles) {
    throw new Error('Invalid project file: missing model data');
  }

  // Future version migrations would go here
  // Example:
  // if (project.formatVersion === '0.9') {
  //   // Migrate from 0.9 to 1.0
  //   project.formatVersion = '1.0';
  // }

  // Ensure all expected fields exist with defaults
  if (!project.rods) {
    project.rods = [];
  }

  if (!project.sliceConfig) {
    project.sliceConfig = { thickness: 0.5 };
  }

  if (!project.exportConfig) {
    project.exportConfig = {
      paperSize: 'a4',
      scale: 1,
      showLabelCut: true,
    };
  }

  if (!project.packingConfig) {
    project.packingConfig = {
      pieceSpacing: 2,
      numberHeight: 5,
      fastMode: false,
    };
  }

  if (!project.uiState) {
    project.uiState = {
      showFloating: true,
      rodDiameter: 1.5,
      currentLayer: 0,
    };
  }
}

/**
 * Converts project model data back to IndexedMesh format
 */
export function projectToIndexedMesh(projectModel: ProjectModel): IndexedMesh {
  // Recompute bounding box if not present or invalid
  let boundingBox = projectModel.boundingBox;
  if (!boundingBox || !boundingBox.min || !boundingBox.max) {
    boundingBox = computeBoundingBox(projectModel.vertices);
  }

  return {
    vertices: projectModel.vertices,
    triangles: projectModel.triangles,
    boundingBox,
  };
}
