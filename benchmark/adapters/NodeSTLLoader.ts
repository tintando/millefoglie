import * as fs from 'node:fs';
import * as path from 'node:path';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { bufferGeometryToIndexedMesh, centerMesh } from '../../src/core/MeshProcessor';
import { IndexedMesh } from '../../src/types/geometry';

/**
 * Load an STL file from the filesystem and convert to IndexedMesh.
 * Works in Node.js environment without browser APIs.
 */
export function loadSTLFile(filePath: string): IndexedMesh {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`STL file not found: ${absolutePath}`);
  }

  // Read file as buffer
  const buffer = fs.readFileSync(absolutePath);

  // Convert Node Buffer to ArrayBuffer
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );

  // Parse using three.js STLLoader
  const loader = new STLLoader();
  const geometry = loader.parse(arrayBuffer);

  // Convert to IndexedMesh and center it
  const mesh = bufferGeometryToIndexedMesh(geometry);
  return centerMesh(mesh);
}
