import { PAPER_SIZES, ExportConfig, DEFAULT_EXPORT_CONFIG, PackingExportConfig, DEFAULT_PACKING_EXPORT_CONFIG, PaperSize } from '../types/export';
import { SliceConfig } from '../types/slice';
import { AlignmentRod } from '../types/rod';

export interface ControlPanelEvents {
  onThicknessChange?: (thickness: number) => void;
  onPaperSizeChange?: (paperSize: string) => void;
  onScaleChange?: (scale: number) => void;
  onShowFloatingChange?: (show: boolean) => void;
  onLiveIntersectionsChange?: (enabled: boolean) => void;
  onLabelCutChange?: (show: boolean) => void;
  onRodDiameterChange?: (diameter: number) => void;
  onSelectedRodDiameterChange?: (rodId: string, diameter: number) => void;
  onDeleteRod?: (rodId: string) => void;
  onRodSelect?: (rodId: string | null) => void;
  onRodVisibilityToggle?: (rodId: string) => void;
  onApplyRodChanges?: () => void;
  onExportZIP?: () => void;
  onExportPacked?: () => void;
}

export class ControlPanel {
  private events: ControlPanelEvents = {};
  private rodDiameter: number = 1.5;
  private selectedRodId: string | null = null;
  private defaultDiameter: number = 1.5;

  // DOM elements
  private thicknessSlider: HTMLInputElement;
  private thicknessValue: HTMLElement;
  private paperSizeSelect: HTMLSelectElement;
  private customPaperSizeDiv: HTMLElement;
  private customPaperWidthInput: HTMLInputElement;
  private customPaperHeightInput: HTMLInputElement;
  private scaleInput: HTMLInputElement;
  private showFloatingCheckbox: HTMLInputElement;
  private liveIntersectionsCheckbox: HTMLInputElement;
  private showLabelCutCheckbox: HTMLInputElement;
  private rodDiameterSlider: HTMLInputElement;
  private rodDiameterValue: HTMLElement;
  private rodList: HTMLElement;
  private applyRodChangesBtn: HTMLButtonElement | null = null;
  private exportZIPBtn: HTMLButtonElement;
  private exportPackedBtn: HTMLButtonElement;

  // Packing config elements
  private pieceSpacingInput: HTMLInputElement;
  private numberHeightInput: HTMLInputElement;
  private fastPackingCheckbox: HTMLInputElement;

  constructor() {
    // Get DOM elements
    this.thicknessSlider = document.getElementById('thickness-slider') as HTMLInputElement;
    this.thicknessValue = document.getElementById('thickness-value') as HTMLElement;
    this.paperSizeSelect = document.getElementById('paper-size') as HTMLSelectElement;
    this.customPaperSizeDiv = document.getElementById('custom-paper-size') as HTMLElement;
    this.customPaperWidthInput = document.getElementById('custom-paper-width') as HTMLInputElement;
    this.customPaperHeightInput = document.getElementById('custom-paper-height') as HTMLInputElement;
    this.scaleInput = document.getElementById('scale-factor') as HTMLInputElement;
    this.showFloatingCheckbox = document.getElementById('show-floating') as HTMLInputElement;
    this.liveIntersectionsCheckbox = document.getElementById('live-intersections') as HTMLInputElement;
    this.showLabelCutCheckbox = document.getElementById('show-label-cut') as HTMLInputElement;
    this.rodDiameterSlider = document.getElementById('rod-diameter') as HTMLInputElement;
    this.rodDiameterValue = document.getElementById('rod-diameter-value') as HTMLElement;
    this.rodList = document.getElementById('rod-list') as HTMLElement;
    this.exportZIPBtn = document.getElementById('export-zip') as HTMLButtonElement;
    this.exportPackedBtn = document.getElementById('export-packed') as HTMLButtonElement;

    // Packing config elements
    this.pieceSpacingInput = document.getElementById('piece-spacing') as HTMLInputElement;
    this.numberHeightInput = document.getElementById('number-height') as HTMLInputElement;
    this.fastPackingCheckbox = document.getElementById('fast-packing') as HTMLInputElement;

    this.setupEventListeners();

    // Initialize custom paper size visibility based on current selection
    this.customPaperSizeDiv.style.display = this.paperSizeSelect.value === 'custom' ? 'block' : 'none';

    // Sync slider displays with actual values (fixes browser caching issues)
    const thickness = parseFloat(this.thicknessSlider.value);
    this.thicknessValue.textContent = `${thickness.toFixed(2)} mm`;

    this.rodDiameter = parseFloat(this.rodDiameterSlider.value);
    this.defaultDiameter = this.rodDiameter;
    this.rodDiameterValue.textContent = `${this.rodDiameter.toFixed(1)} mm`;
  }

  private setupEventListeners(): void {
    // Thickness slider - update display on input, but only fire change event on release
    this.thicknessSlider.addEventListener('input', () => {
      const value = parseFloat(this.thicknessSlider.value);
      this.thicknessValue.textContent = `${value.toFixed(2)} mm`;
    });

    this.thicknessSlider.addEventListener('change', () => {
      const value = parseFloat(this.thicknessSlider.value);
      if (this.events.onThicknessChange) {
        this.events.onThicknessChange(value);
      }
    });

    // Paper size
    this.paperSizeSelect.addEventListener('change', () => {
      const isCustom = this.paperSizeSelect.value === 'custom';
      this.customPaperSizeDiv.style.display = isCustom ? 'block' : 'none';
      if (this.events.onPaperSizeChange) {
        this.events.onPaperSizeChange(this.paperSizeSelect.value);
      }
    });

    // Custom paper size inputs
    this.customPaperWidthInput.addEventListener('change', () => {
      if (this.events.onPaperSizeChange) {
        this.events.onPaperSizeChange('custom');
      }
    });

    this.customPaperHeightInput.addEventListener('change', () => {
      if (this.events.onPaperSizeChange) {
        this.events.onPaperSizeChange('custom');
      }
    });

    // Scale
    this.scaleInput.addEventListener('change', () => {
      const value = parseFloat(this.scaleInput.value);
      if (!isNaN(value) && value > 0) {
        if (this.events.onScaleChange) {
          this.events.onScaleChange(value);
        }
      }
    });

    // Show floating
    this.showFloatingCheckbox.addEventListener('change', () => {
      if (this.events.onShowFloatingChange) {
        this.events.onShowFloatingChange(this.showFloatingCheckbox.checked);
      }
    });

    // Live intersection preview while placing a rod
    this.liveIntersectionsCheckbox.addEventListener('change', () => {
      if (this.events.onLiveIntersectionsChange) {
        this.events.onLiveIntersectionsChange(this.liveIntersectionsCheckbox.checked);
      }
    });

    // Label cut checkbox
    this.showLabelCutCheckbox.addEventListener('change', () => {
      if (this.events.onLabelCutChange) {
        this.events.onLabelCutChange(this.showLabelCutCheckbox.checked);
      }
    });

    // Rod diameter
    this.rodDiameterSlider.addEventListener('input', () => {
      this.rodDiameter = parseFloat(this.rodDiameterSlider.value);
      this.rodDiameterValue.textContent = `${this.rodDiameter.toFixed(1)} mm`;

      if (this.selectedRodId) {
        // Adjust diameter of selected rod
        if (this.events.onSelectedRodDiameterChange) {
          this.events.onSelectedRodDiameterChange(this.selectedRodId, this.rodDiameter);
        }
      } else {
        // Set diameter for new rods
        this.defaultDiameter = this.rodDiameter;
        if (this.events.onRodDiameterChange) {
          this.events.onRodDiameterChange(this.rodDiameter);
        }
      }
    });

    // Export buttons
    this.exportZIPBtn.addEventListener('click', () => {
      if (this.events.onExportZIP) {
        this.events.onExportZIP();
      }
    });

    this.exportPackedBtn.addEventListener('click', () => {
      if (this.events.onExportPacked) {
        this.events.onExportPacked();
      }
    });
  }

  setEvents(events: ControlPanelEvents): void {
    this.events = events;
  }

  getSliceConfig(): SliceConfig {
    return {
      thickness: parseFloat(this.thicknessSlider.value),
    };
  }

  getExportConfig(): ExportConfig {
    let paperSize: PaperSize;
    if (this.paperSizeSelect.value === 'custom') {
      paperSize = {
        name: 'Custom',
        width: parseFloat(this.customPaperWidthInput.value) || 210,
        height: parseFloat(this.customPaperHeightInput.value) || 297,
      };
    } else {
      paperSize = PAPER_SIZES[this.paperSizeSelect.value] || PAPER_SIZES.a4;
    }

    return {
      paperSize,
      scale: parseFloat(this.scaleInput.value) || 1,
      showLabelCut: this.showLabelCutCheckbox.checked,
      margin: DEFAULT_EXPORT_CONFIG.margin,
      strokeWidth: DEFAULT_EXPORT_CONFIG.strokeWidth,
    };
  }

  getRodDiameter(): number {
    return this.rodDiameter;
  }

  getPackingConfig(): PackingExportConfig {
    return {
      pieceSpacing: parseFloat(this.pieceSpacingInput.value) || DEFAULT_PACKING_EXPORT_CONFIG.pieceSpacing,
      rotationSteps: DEFAULT_PACKING_EXPORT_CONFIG.rotationSteps,
      numberHeight: parseFloat(this.numberHeightInput.value) || DEFAULT_PACKING_EXPORT_CONFIG.numberHeight,
      fastMode: this.fastPackingCheckbox.checked,
    };
  }

  getShowFloating(): boolean {
    return this.showFloatingCheckbox.checked;
  }

  getLiveIntersections(): boolean {
    return this.liveIntersectionsCheckbox.checked;
  }

  updateRodList(rods: AlignmentRod[], hasPendingChanges: boolean = false, selectedRodId: string | null = null): void {
    this.rodList.innerHTML = '';

    if (rods.length === 0) {
      this.rodList.innerHTML = '<div class="empty-hint">No rods placed</div>';
      this.applyRodChangesBtn = null;
      return;
    }

    rods.forEach((rod, index) => {
      const item = document.createElement('div');
      item.className = 'rod-item' + (rod.id === selectedRodId ? ' selected' : '');
      item.style.cursor = 'pointer';
      const zRange = `Z: ${(rod.bottomZ * 100).toFixed(0)}%-${(rod.topZ * 100).toFixed(0)}%`;
      const isHidden = rod.hidden ?? false;
      item.innerHTML = `
        <span><strong>Rod ${index + 1}</strong> (${rod.position.x.toFixed(1)}, ${rod.position.y.toFixed(1)}) ${zRange}</span>
        <div class="rod-actions">
          <button class="visibility-btn${isHidden ? ' hidden' : ''}" data-rod-id="${rod.id}" title="${isHidden ? 'Show rod' : 'Hide rod'}">
            <svg class="eye-open" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <svg class="eye-closed" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>
          <button class="delete-btn" data-rod-id="${rod.id}" title="Delete rod">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      `;

      // Click anywhere on item to select/deselect (except action buttons)
      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const isActionBtn = target.closest('.delete-btn') !== null || target.closest('.visibility-btn') !== null;
        if (!isActionBtn) {
          // Toggle selection: deselect if already selected
          if (rod.id === selectedRodId) {
            this.events.onRodSelect?.(null);
          } else {
            this.events.onRodSelect?.(rod.id);
          }
        }
      });

      const visibilityBtn = item.querySelector('.visibility-btn');
      visibilityBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.events.onRodVisibilityToggle) {
          this.events.onRodVisibilityToggle(rod.id);
        }
      });

      const deleteBtn = item.querySelector('.delete-btn');
      deleteBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.events.onDeleteRod) {
          this.events.onDeleteRod(rod.id);
        }
      });

      this.rodList.appendChild(item);
    });

    // Add apply button
    this.applyRodChangesBtn = document.createElement('button');
    this.applyRodChangesBtn.className = 'btn btn-secondary';
    this.applyRodChangesBtn.style.marginTop = '8px';
    this.applyRodChangesBtn.textContent = 'Apply Rod Changes';
    this.applyRodChangesBtn.disabled = !hasPendingChanges;
    this.applyRodChangesBtn.addEventListener('click', () => {
      if (this.events.onApplyRodChanges) {
        this.events.onApplyRodChanges();
      }
    });
    this.rodList.appendChild(this.applyRodChangesBtn);
  }

  setRodChangesPending(pending: boolean): void {
    if (this.applyRodChangesBtn) {
      this.applyRodChangesBtn.disabled = !pending;
      if (pending) {
        this.applyRodChangesBtn.textContent = 'Apply Rod Changes*';
      } else {
        this.applyRodChangesBtn.textContent = 'Apply Rod Changes';
      }
    }
  }

  setSelectedRod(rodId: string | null, diameter?: number): void {
    this.selectedRodId = rodId;
    if (rodId && diameter !== undefined) {
      // Show selected rod's diameter
      this.rodDiameter = diameter;
      this.rodDiameterSlider.value = diameter.toString();
      this.rodDiameterValue.textContent = `${diameter.toFixed(1)} mm`;
    } else if (!rodId) {
      // Restore default diameter for new rods
      this.rodDiameter = this.defaultDiameter;
      this.rodDiameterSlider.value = this.defaultDiameter.toString();
      this.rodDiameterValue.textContent = `${this.defaultDiameter.toFixed(1)} mm`;
    }
  }

  setExportEnabled(enabled: boolean): void {
    this.exportZIPBtn.disabled = !enabled;
    this.exportPackedBtn.disabled = !enabled;
  }

  // Setter methods for loading projects
  setSliceConfig(config: { thickness: number }): void {
    this.thicknessSlider.value = config.thickness.toString();
    this.thicknessValue.textContent = `${config.thickness.toFixed(2)} mm`;
  }

  setExportConfig(config: {
    paperSize: string;
    customPaperWidth?: number;
    customPaperHeight?: number;
    scale: number;
    showLabelCut: boolean;
  }): void {
    this.paperSizeSelect.value = config.paperSize;
    this.customPaperSizeDiv.style.display = config.paperSize === 'custom' ? 'block' : 'none';

    if (config.paperSize === 'custom') {
      if (config.customPaperWidth) {
        this.customPaperWidthInput.value = config.customPaperWidth.toString();
      }
      if (config.customPaperHeight) {
        this.customPaperHeightInput.value = config.customPaperHeight.toString();
      }
    }

    this.scaleInput.value = config.scale.toString();
    this.showLabelCutCheckbox.checked = config.showLabelCut;
  }

  setPackingConfig(config: {
    pieceSpacing: number;
    numberHeight: number;
    fastMode: boolean;
  }): void {
    this.pieceSpacingInput.value = config.pieceSpacing.toString();
    this.numberHeightInput.value = config.numberHeight.toString();
    this.fastPackingCheckbox.checked = config.fastMode;
  }

  setShowFloating(show: boolean): void {
    this.showFloatingCheckbox.checked = show;
  }

  setRodDiameter(diameter: number): void {
    this.rodDiameter = diameter;
    this.defaultDiameter = diameter;
    this.rodDiameterSlider.value = diameter.toString();
    this.rodDiameterValue.textContent = `${diameter.toFixed(1)} mm`;
  }
}
