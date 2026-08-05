export interface LayerNavigatorEvents {
  onLayerChange?: (layerIndex: number) => void;
}

export class LayerNavigator {
  private slider: HTMLInputElement;
  private layerNumberDisplay: HTMLElement;
  private layerHeightDisplay: HTMLElement;
  private events: LayerNavigatorEvents = {};
  private layerCount: number = 0;
  private thickness: number = 0.5;
  private startZ: number = 0;

  constructor() {
    this.slider = document.getElementById('layer-slider') as HTMLInputElement;
    this.layerNumberDisplay = document.getElementById('layer-number') as HTMLElement;
    this.layerHeightDisplay = document.getElementById('layer-height') as HTMLElement;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.slider.addEventListener('input', () => {
      const layerIndex = parseInt(this.slider.value);
      this.updateDisplay(layerIndex);

      if (this.events.onLayerChange) {
        this.events.onLayerChange(layerIndex);
      }
    });
  }

  setEvents(events: LayerNavigatorEvents): void {
    this.events = events;
  }

  setLayerCount(count: number, thickness: number, startZ: number = 0): void {
    this.layerCount = count;
    this.thickness = thickness;
    this.startZ = startZ;

    this.slider.min = '0';
    this.slider.max = String(Math.max(0, count - 1));
    this.slider.disabled = count === 0;

    if (count > 0) {
      this.slider.value = '0';
      this.updateDisplay(0);
    } else {
      this.layerNumberDisplay.textContent = 'Layer: 0 / 0';
      this.layerHeightDisplay.textContent = 'Height: 0.00 mm';
    }
  }

  getCurrentLayer(): number {
    return parseInt(this.slider.value);
  }

  setCurrentLayer(layerIndex: number): void {
    if (layerIndex >= 0 && layerIndex < this.layerCount) {
      this.slider.value = String(layerIndex);
      this.updateDisplay(layerIndex);
    }
  }

  private updateDisplay(layerIndex: number): void {
    this.layerNumberDisplay.textContent = `Layer: ${layerIndex + 1} / ${this.layerCount}`;

    const height = this.startZ + this.thickness / 2 + layerIndex * this.thickness;
    this.layerHeightDisplay.textContent = `Height: ${height.toFixed(2)} mm`;
  }

  nextLayer(): void {
    const current = this.getCurrentLayer();
    if (current < this.layerCount - 1) {
      this.setCurrentLayer(current + 1);
      if (this.events.onLayerChange) {
        this.events.onLayerChange(current + 1);
      }
    }
  }

  previousLayer(): void {
    const current = this.getCurrentLayer();
    if (current > 0) {
      this.setCurrentLayer(current - 1);
      if (this.events.onLayerChange) {
        this.events.onLayerChange(current - 1);
      }
    }
  }
}
