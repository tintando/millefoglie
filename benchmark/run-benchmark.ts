import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadSTLFile } from './adapters/NodeSTLLoader';
import { saveAllPackedSheetsSVG } from './adapters/NodeSVGExporter';
import { loadDigitFonts } from './adapters/NodeFontLoader';
import { DEFAULT_BENCHMARK_CONFIG, FAST_BENCHMARK_CONFIG, BenchmarkConfig } from './config/benchmark.config';
import { Slicer } from '../src/core/Slicer';
import { extractPiecesFromSlices } from '../src/packing/PieceExtractor';
import { packPiecesWithProgress } from '../src/packing/Packer';
import { initializeFontsFromData } from '../src/packing/SingleStrokeFont';

// Parse command line arguments
const args = process.argv.slice(2);
const useFastMode = args.includes('--fast');

interface BenchmarkResult {
  timestamp: string;
  modelPath: string;
  layerCount: number;
  totalPieces: number;
  packTimeMs: number;
  sheetCount: number;
  averageUtilization: number;
  unplacedPieces: number;
  config: BenchmarkConfig;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function runBenchmark(config: BenchmarkConfig = DEFAULT_BENCHMARK_CONFIG): Promise<BenchmarkResult> {
  const startTime = Date.now();

  console.log('='.repeat(60));
  console.log('Millefoglie Packing Benchmark');
  console.log('='.repeat(60));
  console.log();

  // Initialize fonts for Node.js environment
  console.log('Loading fonts...');
  const { digits, widths } = loadDigitFonts();
  initializeFontsFromData(digits, widths);
  console.log('  Fonts loaded');
  console.log();

  // Ensure output directory exists
  const outputDir = path.resolve(config.outputDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Load STL
  console.log(`Loading model: ${config.modelPath}`);
  const loadStart = Date.now();
  const mesh = loadSTLFile(config.modelPath);
  console.log(`  Loaded in ${formatTime(Date.now() - loadStart)}`);
  console.log(`  Vertices: ${mesh.vertices.length}`);
  console.log(`  Triangles: ${mesh.triangles.length}`);
  const dims = {
    width: mesh.boundingBox.max.x - mesh.boundingBox.min.x,
    height: mesh.boundingBox.max.y - mesh.boundingBox.min.y,
    depth: mesh.boundingBox.max.z - mesh.boundingBox.min.z,
  };
  console.log(`  Dimensions: ${dims.width.toFixed(1)} x ${dims.height.toFixed(1)} x ${dims.depth.toFixed(1)} mm`);
  console.log();

  // Slice
  console.log(`Slicing with ${config.sliceConfig.thickness}mm layer thickness...`);
  const sliceStart = Date.now();
  const slicer = new Slicer(mesh);
  const sliceResult = slicer.slice(
    { thickness: config.sliceConfig.thickness },
    {
      onProgress: (percent) => {
        process.stdout.write(`\r  Slicing: ${percent}%`);
      },
    }
  );
  console.log(`\r  Sliced in ${formatTime(Date.now() - sliceStart)}       `);
  console.log(`  Layers: ${sliceResult.layerCount}`);
  console.log();

  // Extract pieces
  console.log('Extracting pieces...');
  const extractStart = Date.now();
  const pieces = extractPiecesFromSlices(sliceResult.slices);
  console.log(`  Extracted ${pieces.length} pieces in ${formatTime(Date.now() - extractStart)}`);
  console.log();

  // Pack
  console.log('Packing pieces...');
  console.log(`  Paper size: ${config.packingConfig.paperWidth} x ${config.packingConfig.paperHeight} mm`);
  console.log(`  Fast mode: ${config.packingConfig.fastMode ? 'ON' : 'OFF'}`);
  const packStart = Date.now();
  const packingResult = packPiecesWithProgress(
    pieces,
    config.packingConfig,
    (current, total, sheets) => {
      const percent = Math.round((current / total) * 100);
      process.stdout.write(`\r  Packing: ${percent}% (${current}/${total} pieces, ${sheets} sheets)`);
    }
  );
  const packTimeMs = Date.now() - packStart;
  console.log(`\r  Packed in ${formatTime(packTimeMs)}                              `);
  console.log(`  Sheets: ${packingResult.sheets.length}`);
  console.log(`  Unplaced: ${packingResult.unplacedPieces.length}`);
  console.log();

  // Calculate average utilization
  const avgUtilization =
    packingResult.sheets.length > 0
      ? packingResult.sheets.reduce((sum, s) => sum + s.utilization, 0) / packingResult.sheets.length
      : 0;

  // Export SVGs
  console.log(`Exporting SVGs to ${outputDir}...`);
  const exportStart = Date.now();
  const savedPaths = saveAllPackedSheetsSVG(packingResult.sheets, config.packingConfig, outputDir);
  console.log(`  Exported ${savedPaths.length} SVGs in ${formatTime(Date.now() - exportStart)}`);
  for (const p of savedPaths) {
    console.log(`    - ${path.basename(p)}`);
  }
  console.log();

  // Build result
  const result: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    modelPath: config.modelPath,
    layerCount: sliceResult.layerCount,
    totalPieces: pieces.length,
    packTimeMs,
    sheetCount: packingResult.sheets.length,
    averageUtilization: avgUtilization,
    unplacedPieces: packingResult.unplacedPieces.length,
    config,
  };

  // Save results JSON
  const resultsPath = path.join(outputDir, 'benchmark-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Results saved to: ${resultsPath}`);
  console.log();

  // Summary
  const totalTime = Date.now() - startTime;
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`  Total time: ${formatTime(totalTime)}`);
  console.log(`  Layers: ${result.layerCount}`);
  console.log(`  Pieces: ${result.totalPieces}`);
  console.log(`  Pack time: ${formatTime(result.packTimeMs)}`);
  console.log(`  Sheets: ${result.sheetCount}`);
  console.log(`  Avg utilization: ${(result.averageUtilization * 100).toFixed(1)}%`);
  console.log(`  Unplaced: ${result.unplacedPieces}`);
  console.log();

  return result;
}

// Run benchmark with selected config
const config = useFastMode ? FAST_BENCHMARK_CONFIG : DEFAULT_BENCHMARK_CONFIG;
runBenchmark(config).catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
