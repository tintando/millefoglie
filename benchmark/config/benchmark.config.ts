import { PackingConfig } from '../../src/packing/types';

export interface BenchmarkConfig {
  modelPath: string;
  outputDir: string;
  sliceConfig: {
    thickness: number;
  };
  packingConfig: PackingConfig;
}

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  modelPath: './models/3DBenchy.stl',
  outputDir: './benchmark/results',
  sliceConfig: {
    thickness: 0.50,
  },
  packingConfig: {
    paperWidth: 290,
    paperHeight: 290,
    pieceSpacing: 2,
    rotationSteps: 12,
    numberHeight: 5,
    margin: 10,
    strokeWidth: 0.2,
    showLabelCut: true,
    fastMode: false,  // Set true for AABB-only collision (faster but less efficient packing)
  },
};

// Fast mode configuration (for quick previews)
export const FAST_BENCHMARK_CONFIG: BenchmarkConfig = {
  ...DEFAULT_BENCHMARK_CONFIG,
  packingConfig: {
    ...DEFAULT_BENCHMARK_CONFIG.packingConfig,
    fastMode: true,
  },
};
