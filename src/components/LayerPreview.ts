import { Slice } from '../types/slice';
import { ExportConfig } from '../types/export';
import { renderSliceContent, getSliceBounds, SlicePalette, DEFAULT_SLICE_PALETTE } from '../export/SliceRenderer';
import { ResolvedTheme } from '../ui/ThemeManager';

/**
 * Preview-only palette for dark mode. Exports never use this - they always
 * fall through to DEFAULT_SLICE_PALETTE in SliceRenderer.
 */
const DARK_PREVIEW_PALETTE: SlicePalette = {
  fill: '#2c2c40',
  hole: '#0f0f1a',
  stroke: '#c9c9d6',
  floatingFill: '#5c4a12',
  floatingStroke: '#ff9a3c',
  holeStroke: '#5aa6ef',
  labelStroke: '#c9c9d6',
};

export class LayerPreview {
  private container: HTMLElement;
  private svgElement: SVGSVGElement | null = null;
  private currentSlice: Slice | null = null;
  private config: ExportConfig;
  private viewBox = { x: 0, y: 0, width: 100, height: 100 };
  private isPanning = false;
  private lastMouse = { x: 0, y: 0 };
  private zoom = 1;
  private theme: ResolvedTheme = 'dark';

  constructor(container: HTMLElement, config: ExportConfig, theme: ResolvedTheme = 'dark') {
    this.container = container;
    this.config = config;
    this.theme = theme;

    this.createSVG();
    this.setupInteraction();
  }

  private createSVG(): void {
    this.svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svgElement.setAttribute('width', '100%');
    this.svgElement.setAttribute('height', '100%');
    // No inline background: the SVG is transparent so #preview-container's
    // var(--preview-bg) shows through and follows the theme for free.
    this.container.appendChild(this.svgElement);
  }

  /** Re-colours the current slice without disturbing the user's pan/zoom. */
  setTheme(theme: ResolvedTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    if (this.currentSlice) {
      this.renderContent(this.currentSlice);
    }
  }

  private setupInteraction(): void {
    if (!this.svgElement) return;

    // Pan
    this.svgElement.addEventListener('mousedown', (e) => {
      this.isPanning = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });

    this.svgElement.addEventListener('mousemove', (e) => {
      if (!this.isPanning) return;

      const dx = (e.clientX - this.lastMouse.x) * (this.viewBox.width / this.container.clientWidth);
      const dy = (e.clientY - this.lastMouse.y) * (this.viewBox.height / this.container.clientHeight);

      this.viewBox.x -= dx;
      this.viewBox.y -= dy;

      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.updateViewBox();
    });

    this.svgElement.addEventListener('mouseup', () => {
      this.isPanning = false;
    });

    this.svgElement.addEventListener('mouseleave', () => {
      this.isPanning = false;
    });

    // Zoom
    this.svgElement.addEventListener('wheel', (e) => {
      e.preventDefault();

      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      const newZoom = this.zoom * zoomFactor;

      if (newZoom < 0.1 || newZoom > 10) return;

      // Zoom toward mouse position
      const rect = this.svgElement!.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) / rect.width;
      const mouseY = (e.clientY - rect.top) / rect.height;

      const newWidth = this.viewBox.width * zoomFactor;
      const newHeight = this.viewBox.height * zoomFactor;

      this.viewBox.x += (this.viewBox.width - newWidth) * mouseX;
      this.viewBox.y += (this.viewBox.height - newHeight) * mouseY;
      this.viewBox.width = newWidth;
      this.viewBox.height = newHeight;

      this.zoom = newZoom;
      this.updateViewBox();
    });
  }

  private updateViewBox(): void {
    if (!this.svgElement) return;
    this.svgElement.setAttribute(
      'viewBox',
      `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`
    );
  }

  setConfig(config: ExportConfig): void {
    this.config = config;
    if (this.currentSlice) {
      this.render(this.currentSlice);
    }
  }

  render(slice: Slice): void {
    if (!this.svgElement) return;

    this.currentSlice = slice;

    // Calculate bounds
    const bounds = getSliceBounds(slice);
    if (!bounds) {
      // Empty slice
      this.svgElement.innerHTML = '';
      return;
    }

    // Add margin
    const margin = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.1;
    const minX = bounds.minX - margin;
    const maxX = bounds.maxX + margin;
    const minY = bounds.minY - margin;
    const maxY = bounds.maxY + margin;

    // Set viewBox (flip Y axis)
    this.viewBox = {
      x: minX,
      y: -maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
    this.updateViewBox();

    this.renderContent(slice);
  }

  /**
   * Redraws the layer already on screen after its content changed, such as a
   * rod hole moving under the cursor. Unlike render() this keeps the viewBox,
   * so the user's pan and zoom survive an update they did not ask for.
   */
  refresh(slice: Slice): void {
    if (!this.currentSlice) return;
    this.currentSlice = slice;
    this.renderContent(slice);
  }

  /** Draws the slice into the SVG, leaving the viewBox alone. */
  private renderContent(slice: Slice): void {
    if (!this.svgElement) return;

    // Use shared renderer to generate content
    const content = renderSliceContent(slice, {
      strokeWidth: this.config.strokeWidth,
      showLabelCut: this.config.showLabelCut,
      showFloating: true,
      palette: this.theme === 'dark' ? DARK_PREVIEW_PALETTE : DEFAULT_SLICE_PALETTE,
    });

    // Wrap in a group with Y-flip and set as innerHTML
    this.svgElement.innerHTML = `<g transform="scale(1, -1)">${content}</g>`;
  }

  fitToContent(): void {
    if (!this.currentSlice) return;
    this.render(this.currentSlice);
  }

  clear(): void {
    if (!this.svgElement) return;
    this.svgElement.innerHTML = '';
    this.currentSlice = null;
  }
}
