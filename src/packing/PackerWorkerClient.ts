import { PackablePiece, PackingConfig, PackingResult } from './types';
import { packPiecesWithProgress } from './Packer';

type ProgressCallback = (current: number, total: number, sheets: number) => void;

/**
 * Client for communicating with the packing worker.
 * Falls back to main thread execution if Workers are unavailable.
 */
export class PackerWorkerClient {
  private worker: Worker | null = null;
  private workersAvailable: boolean;

  constructor() {
    // Check if Web Workers are available
    this.workersAvailable = typeof Worker !== 'undefined';
  }

  /**
   * Pack pieces using a background worker (or main thread fallback).
   */
  async packPieces(
    pieces: PackablePiece[],
    config: PackingConfig,
    onProgress?: ProgressCallback
  ): Promise<PackingResult> {
    if (!this.workersAvailable) {
      // Fallback to main thread
      return packPiecesWithProgress(pieces, config, onProgress);
    }

    return new Promise((resolve) => {
      try {
        // Create worker using Vite's worker import syntax
        this.worker = new Worker(
          new URL('./packing.worker.ts', import.meta.url),
          { type: 'module' }
        );

        this.worker.onmessage = (e: MessageEvent) => {
          const data = e.data;

          if (data.type === 'progress' && onProgress) {
            onProgress(data.current, data.total, data.sheets);
          } else if (data.type === 'complete') {
            resolve(data.result);
            this.terminateWorker();
          }
        };

        this.worker.onerror = (error) => {
          console.error('Worker error:', error);
          this.terminateWorker();
          // Fallback to main thread on worker error
          resolve(packPiecesWithProgress(pieces, config, onProgress));
        };

        // Send pack request to worker
        this.worker.postMessage({
          type: 'pack',
          pieces,
          config,
        });
      } catch (error) {
        console.error('Failed to create worker:', error);
        // Fallback to main thread
        resolve(packPiecesWithProgress(pieces, config, onProgress));
      }
    });
  }

  /**
   * Terminate the worker if running.
   */
  terminate(): void {
    this.terminateWorker();
  }

  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
