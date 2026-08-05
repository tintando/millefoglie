import { PackablePiece, PackingConfig } from './types';
import { packPiecesWithProgress } from './Packer';

// Message types for worker communication
export interface PackWorkerRequest {
  type: 'pack';
  pieces: PackablePiece[];
  config: PackingConfig;
}

export interface PackWorkerProgressResponse {
  type: 'progress';
  current: number;
  total: number;
  sheets: number;
}

export interface PackWorkerCompleteResponse {
  type: 'complete';
  result: ReturnType<typeof packPiecesWithProgress>;
}

export type PackWorkerResponse = PackWorkerProgressResponse | PackWorkerCompleteResponse;

// Worker message handler
self.onmessage = (e: MessageEvent<PackWorkerRequest>) => {
  const { type, pieces, config } = e.data;

  if (type === 'pack') {
    const result = packPiecesWithProgress(pieces, config, (current, total, sheets) => {
      const response: PackWorkerProgressResponse = {
        type: 'progress',
        current,
        total,
        sheets,
      };
      self.postMessage(response);
    });

    const response: PackWorkerCompleteResponse = {
      type: 'complete',
      result,
    };
    self.postMessage(response);
  }
};
