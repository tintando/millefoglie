import { Slice } from '../types/slice';
import { ExportConfig } from '../types/export';
import { renderSliceContent } from './SliceRenderer';

export class SVGExporter {
  private config: ExportConfig;

  constructor(config: ExportConfig) {
    this.config = config;
  }

  setConfig(config: ExportConfig): void {
    this.config = config;
  }

  exportSlice(slice: Slice, modelBounds: { minX: number; maxX: number; minY: number; maxY: number }): string {
    const { paperSize, scale, margin, strokeWidth, showLabelCut } = this.config;

    // Calculate scaled model dimensions
    const modelWidth = (modelBounds.maxX - modelBounds.minX) * scale;
    const modelHeight = (modelBounds.maxY - modelBounds.minY) * scale;

    // Calculate offset to center model on paper
    const availableWidth = paperSize.width - 2 * margin;
    const availableHeight = paperSize.height - 2 * margin;

    const offsetX = margin + (availableWidth - modelWidth) / 2 - modelBounds.minX * scale;
    const offsetY = margin + (availableHeight - modelHeight) / 2 - modelBounds.minY * scale;

    // Start SVG
    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${paperSize.width}mm"
     height="${paperSize.height}mm"
     viewBox="0 0 ${paperSize.width} ${paperSize.height}">
  <title>Layer ${slice.layerIndex + 1}</title>
  <desc>Millefoglie export - Layer ${slice.layerIndex + 1} at z=${slice.zHeight.toFixed(2)}mm</desc>

  <!-- Background -->
  <rect width="100%" height="100%" fill="white"/>

  <!-- Content -->
  <g transform="translate(${offsetX}, ${paperSize.height - offsetY}) scale(${scale}, -${scale})">
`;

    // Use shared renderer for slice content
    svg += renderSliceContent(slice, {
      strokeWidth: strokeWidth / scale,
      showLabelCut,
      showFloating: true,
    });

    svg += `  </g>
</svg>`;

    return svg;
  }

  downloadSlice(slice: Slice, modelBounds: { minX: number; maxX: number; minY: number; maxY: number }, filename?: string): void {
    const svg = this.exportSlice(slice, modelBounds);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `layer_${String(slice.layerIndex + 1).padStart(4, '0')}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }
}
