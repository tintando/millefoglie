import { IndexedMesh } from './types/geometry';
import { Slice, SliceResult, RodHole } from './types/slice';
import { DEFAULT_EXPORT_CONFIG } from './types/export';
import { AlignmentRod } from './types/rod';
import { Viewer3D, NavMode, ViewPreset } from './components/Viewer3D';
import { LayerPreview } from './components/LayerPreview';
import { ControlPanel } from './components/ControlPanel';
import { LayerNavigator } from './components/LayerNavigator';
import { RodTool } from './components/RodTool';
import { HelpOverlay } from './components/HelpOverlay';
import { ThemeManager } from './ui/ThemeManager';
import { isInputFocused } from './ui/domUtils';
import { Slicer } from './core/Slicer';
import { previewRodHoles } from './core/AlignmentRodManager';
import { getMeshStats } from './core/MeshProcessor';
import { createProject, saveProject, loadProject, projectToIndexedMesh, ProjectState } from './core/ProjectManager';
import { SVGExporter } from './export/SVGExporter';
import { ZipExporter } from './export/ZipExporter';
import { extractPiecesFromSlices, PackedSVGExporter, DEFAULT_PACKING_CONFIG, PackingConfig, PackerWorkerClient } from './packing';

/** Names the sample in the status bar, the layer SVGs and any project saved from it. */
const SAMPLE_MODEL_NAME = '3DBenchy-low-poly.stl';

export class App {
  private themeManager: ThemeManager;
  private viewer3D: Viewer3D;
  private layerPreview: LayerPreview;
  private controlPanel: ControlPanel;
  private layerNavigator: LayerNavigator;
  private rodTool: RodTool;
  private helpOverlay: HelpOverlay;

  private slicer: Slicer | null = null;
  private sliceResult: SliceResult | null = null;
  private currentMesh: IndexedMesh | null = null;
  private currentSlice: Slice | null = null;
  private currentProjectName: string = 'millefoglie';

  /**
   * One-shot: makes the next reslice open the layer slider 3/4 of the way up
   * the model instead of preserving the current layer. Set when a fresh model
   * is loaded, cleared as soon as it is consumed, so changing thickness later
   * still preserves where the user was.
   */
  private pendingThreeQuarterLayer = false;
  /** One-shot layer to restore, used when loading a saved project. */
  private initialLayerOverride: number | null = null;
  /** True while loadProjectFile is driving, so handleModelLoaded stands down. */
  private loadingProject = false;
  /** Where the rods being aimed would land, empty when none are. */
  private placementPreviewPositions: Array<{ x: number; y: number }> = [];
  /** Holes last drawn in the 2D preview, so identical redraws can be skipped. */
  private lastRenderedHoleKey = '';

  private svgExporter: SVGExporter;
  private zipExporter: ZipExporter;
  private packedSVGExporter: PackedSVGExporter;
  private packerWorkerClient: PackerWorkerClient;

  private statusBar: HTMLElement;
  private packingProgress: HTMLElement;
  private packingProgressFill: HTMLElement;
  private packingProgressText: HTMLElement;
  private packingProgressTime: HTMLElement;
  private packingCancelBtn: HTMLButtonElement;
  private packingStartTime: number = 0;
  private packingTimerInterval: number | null = null;
  private packingCancelled: boolean = false;
  private progressOverlay: HTMLElement;
  private progressText: HTMLElement;
  private progressFill: HTMLElement;
  private loadBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;
  private dropZone: HTMLElement;
  private viewModeBtn: HTMLButtonElement;
  private downloadCurrentSVGBtn: HTMLButtonElement;
  private saveProjectBtn: HTMLButtonElement;
  private openProjectBtn: HTMLButtonElement;
  private projectFileInput: HTMLInputElement;
  private statusStats: HTMLElement;
  private emptyState: HTMLElement;
  private previewPanel: HTMLElement;
  private navModeBtn: HTMLButtonElement;

  constructor() {
    // Theme first: Viewer3D needs the resolved theme to build its scene with
    // the right background/grid/material rather than recolouring after paint.
    this.themeManager = new ThemeManager();

    // Get DOM elements
    this.statusBar = document.getElementById('status-message') as HTMLElement;
    this.statusStats = document.getElementById('status-stats') as HTMLElement;
    this.emptyState = document.getElementById('empty-state') as HTMLElement;
    this.previewPanel = document.getElementById('preview-panel') as HTMLElement;
    this.navModeBtn = document.getElementById('nav-mode-btn') as HTMLButtonElement;
    this.packingProgress = document.getElementById('packing-progress') as HTMLElement;
    this.packingProgressFill = document.getElementById('packing-progress-fill') as HTMLElement;
    this.packingProgressText = document.getElementById('packing-progress-text') as HTMLElement;
    this.packingProgressTime = document.getElementById('packing-progress-time') as HTMLElement;
    this.packingCancelBtn = document.getElementById('packing-cancel-btn') as HTMLButtonElement;
    this.progressOverlay = document.getElementById('progress-overlay') as HTMLElement;
    this.progressText = document.getElementById('progress-text') as HTMLElement;
    this.progressFill = document.getElementById('progress-fill') as HTMLElement;
    this.loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
    this.fileInput = document.getElementById('file-input') as HTMLInputElement;
    this.dropZone = document.querySelector('.drop-zone') as HTMLElement;
    this.viewModeBtn = document.getElementById('view-mode-btn') as HTMLButtonElement;
    this.downloadCurrentSVGBtn = document.getElementById('download-current-svg') as HTMLButtonElement;
    this.saveProjectBtn = document.getElementById('save-project-btn') as HTMLButtonElement;
    this.openProjectBtn = document.getElementById('open-project-btn') as HTMLButtonElement;
    this.projectFileInput = document.getElementById('project-file-input') as HTMLInputElement;

    // Initialize components
    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    const previewContainer = document.getElementById('preview-container') as HTMLElement;

    const theme = this.themeManager.getResolved();
    this.viewer3D = new Viewer3D(viewerContainer, theme);
    this.layerPreview = new LayerPreview(previewContainer, DEFAULT_EXPORT_CONFIG, theme);
    this.controlPanel = new ControlPanel();
    this.layerNavigator = new LayerNavigator();
    this.rodTool = new RodTool();
    this.helpOverlay = new HelpOverlay();

    this.themeManager.onChange((resolved) => {
      this.viewer3D.setTheme(resolved);
      this.layerPreview.setTheme(resolved);
    });

    // Initialize exporters
    this.svgExporter = new SVGExporter(DEFAULT_EXPORT_CONFIG);
    this.zipExporter = new ZipExporter(DEFAULT_EXPORT_CONFIG);
    this.packedSVGExporter = new PackedSVGExporter(DEFAULT_PACKING_CONFIG);
    this.packerWorkerClient = new PackerWorkerClient();

    // Set up event handlers
    this.setupEventHandlers();

    // Same reason as the symmetry sync in setupEventHandlers: a reload can
    // restore control values the app has never seen.
    this.viewer3D.setLiveIntersections(this.controlPanel.getLiveIntersections());
    const rodDiameter = this.controlPanel.getRodDiameter();
    this.rodTool.setRodDiameter(rodDiameter);
    this.viewer3D.setPreviewDiameter(rodDiameter);
    this.updateExportConfig();

    // Deliberately not awaited: the app is usable while the sample arrives,
    // and a visitor who drops their own file first simply overwrites it.
    void this.loadSampleModel();
  }

  private setupEventHandlers(): void {
    // File loading
    this.loadBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

    // Project save/load
    this.openProjectBtn.addEventListener('click', () => this.projectFileInput.click());
    this.projectFileInput.addEventListener('change', (e) => this.handleProjectFileSelect(e));
    this.saveProjectBtn.addEventListener('click', () => this.handleSaveProject());

    // Packing cancel
    this.packingCancelBtn.addEventListener('click', () => this.cancelPacking());

    // Drag and drop
    const viewerContainer = document.getElementById('viewer-container') as HTMLElement;
    viewerContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('active');
    });
    viewerContainer.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('active');
    });
    viewerContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('active');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        this.handleDroppedFile(files[0]);
      }
    });

    // View mode toggle
    this.viewModeBtn.addEventListener('click', () => {
      this.viewer3D.toggleViewMode();
    });

    // Empty state doubles as a click target for loading a model
    this.emptyState.addEventListener('click', () => this.fileInput.click());

    // Theme + help
    const themeBtn = document.getElementById('theme-btn') as HTMLButtonElement;
    themeBtn.addEventListener('click', () => this.themeManager.toggle());

    const helpBtn = document.getElementById('help-btn') as HTMLButtonElement;
    helpBtn.addEventListener('click', () => this.helpOverlay.toggle());

    // Navigation mode
    this.navModeBtn.addEventListener('click', () => {
      this.viewer3D.setNavMode(this.viewer3D.getNavMode() === 'orbit' ? 'fly' : 'orbit');
    });

    // Zoom to fit
    const fitViewBtn = document.getElementById('fit-view-btn') as HTMLButtonElement;
    fitViewBtn.addEventListener('click', () => this.viewer3D.frameModel());

    // View presets
    const viewPresetBtn = document.getElementById('view-preset-btn') as HTMLButtonElement;
    const viewPresetPopover = document.getElementById('view-preset-popover') as HTMLElement;

    viewPresetBtn.addEventListener('click', () => {
      viewPresetPopover.classList.toggle('visible');
    });

    viewPresetPopover.querySelectorAll<HTMLButtonElement>('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.viewer3D.setViewPreset(btn.dataset.preset as ViewPreset);
        viewPresetPopover.classList.remove('visible');
      });
    });

    // Dismiss any open overlay popover when clicking elsewhere
    document.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.overlay-tool')) return;
      document.querySelectorAll('.overlay-popover.visible')
        .forEach((el) => el.classList.remove('visible'));
    });

    // Symmetry mode
    const symmetryBtn = document.getElementById('symmetry-btn') as HTMLButtonElement;
    const symmetryDropdown = document.getElementById('symmetry-dropdown') as HTMLElement;
    const symmetryEnabled = document.getElementById('symmetry-enabled') as HTMLInputElement;
    const symmetryAxisInputs = document.querySelectorAll('input[name="symmetry-axis"]') as NodeListOf<HTMLInputElement>;

    symmetryBtn.addEventListener('click', () => {
      symmetryDropdown.classList.toggle('visible');
    });

    const applySymmetryEnabled = () => {
      this.rodTool.setSymmetryEnabled(symmetryEnabled.checked);
      symmetryBtn.classList.toggle('active', symmetryEnabled.checked);
      this.viewer3D.setSymmetryEnabled(symmetryEnabled.checked);
    };
    symmetryEnabled.addEventListener('change', applySymmetryEnabled);

    const applySymmetryAxis = (axis: 'x' | 'y') => {
      this.rodTool.setSymmetryAxis(axis);
      this.viewer3D.setSymmetryAxis(axis);
    };
    symmetryAxisInputs.forEach(input => {
      input.addEventListener('change', () => {
        if (input.checked) {
          applySymmetryAxis(input.value as 'x' | 'y');
        }
      });
    });

    // Browsers restore form state across a reload, so the box can come back
    // ticked with nothing having told the app about it: symmetry then looks
    // on and does nothing. Push whatever the controls actually say through
    // the same handlers instead of trusting the markup's defaults.
    applySymmetryEnabled();
    const checkedAxis = Array.from(symmetryAxisInputs).find(input => input.checked);
    if (checkedAxis) {
      applySymmetryAxis(checkedAxis.value as 'x' | 'y');
    }

    // Viewer events
    this.viewer3D.setEvents({
      onModelLoaded: (mesh) => this.handleModelLoaded(mesh),
      onRodPlaced: (x, y) => this.handleRodPlaced(x, y),
      onPlacementPreviewMoved: (positions) => {
        this.placementPreviewPositions = positions;
        this.refreshLayerPreview();
      },
      onRodSelected: (rodId) => this.handleRodSelected(rodId),
      onRodMoved: (rodId, dx, dy, dz) => this.handleRodMoved(rodId, dx, dy, dz),
      onRodHeightAdjusted: (rodId, adjustBottom, delta) => this.handleRodHeightAdjusted(rodId, adjustBottom, delta),
      onViewModeChanged: (mode) => this.handleViewModeChanged(mode),
      onNavModeChanged: (mode) => this.handleNavModeChanged(mode),
    });

    // Download button in preview
    this.downloadCurrentSVGBtn.addEventListener('click', () => this.exportCurrentSVG());

    // Control panel events
    this.controlPanel.setEvents({
      onThicknessChange: (thickness) => this.handleThicknessChange(thickness),
      onPaperSizeChange: () => this.updateExportConfig(),
      onScaleChange: () => this.updateExportConfig(),
      onShowFloatingChange: (show) => this.handleShowFloatingChange(show),
      onLiveIntersectionsChange: (enabled) => {
        this.viewer3D.setLiveIntersections(enabled);
        // Drops the staged holes out of the 2D preview, or brings them back
        this.refreshLayerPreview();
      },
      onLabelCutChange: () => this.updateExportConfig(),
      onRodDiameterChange: (diameter) => {
        this.rodTool.setRodDiameter(diameter);
        this.viewer3D.setPreviewDiameter(diameter);
      },
      onSelectedRodDiameterChange: (rodId, diameter) => this.handleSelectedRodDiameterChange(rodId, diameter),
      onDeleteRod: (rodId) => this.handleDeleteRod(rodId),
      onRodSelect: (rodId) => this.handleRodSelected(rodId ?? null),
      onRodVisibilityToggle: (rodId) => this.handleRodVisibilityToggle(rodId),
      onApplyRodChanges: () => this.handleApplyRodChanges(),
      onExportZIP: () => this.exportAllZIP(),
      onExportPacked: () => this.exportPacked(),
    });

    // Layer navigator events
    this.layerNavigator.setEvents({
      onLayerChange: (layerIndex) => this.handleLayerChange(layerIndex),
    });

    // Rod tool events
    this.rodTool.setEvents({
      onRodsChanged: (rods) => this.handleRodsChanged(rods),
      onActiveChanged: (active) => this.viewer3D.setRodPlacementMode(active),
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Chords work even while a field has focus
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') {
          e.preventDefault();
          if (this.currentMesh) {
            this.handleSaveProject();
          }
        } else if (e.key === 'o') {
          e.preventDefault();
          this.projectFileInput.click();
        }
        return;
      }

      // Escape closes the help overlay, otherwise leaves rod placement mode
      if (e.key === 'Escape') {
        if (this.helpOverlay.isOpen()) {
          this.helpOverlay.close();
        } else if (this.rodTool.isToolActive()) {
          this.rodTool.toggleActive();
        }
        return;
      }

      // Everything below is a bare key, so don't steal it from a focused field
      if (isInputFocused()) return;

      if (e.key === '?' || e.key === 'h' || e.key === 'H') {
        this.helpOverlay.toggle();
        return;
      }

      // The rest are viewer/layer actions that make no sense behind a modal
      if (this.helpOverlay.isOpen()) return;

      if (e.key === 't' || e.key === 'T') {
        this.themeManager.toggle();
        return;
      }

      // Layer navigation - preventDefault so the page/slider doesn't also scroll
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        this.layerNavigator.nextLayer();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        this.layerNavigator.previousLayer();
      }
    });
  }

  private handleNavModeChanged(mode: NavMode): void {
    this.navModeBtn.classList.toggle('fly', mode === 'fly');
    this.navModeBtn.title = mode === 'orbit'
      ? 'Navigation: Orbit (C to switch)'
      : 'Navigation: Fly (C to switch)';
    this.setStatus(mode === 'orbit'
      ? 'Orbit navigation: drag to orbit, right-drag to pan, wheel to zoom'
      : 'Fly navigation: WASD to move, right-drag to look');
  }

  private handleFileSelect(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.loadSTLFile(input.files[0]);
    }
  }

  private handleProjectFileSelect(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.loadProjectFile(input.files[0]);
    }
  }

  private handleDroppedFile(file: File): void {
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.stl')) {
      this.loadSTLFile(file);
    } else if (fileName.endsWith('.mfp')) {
      this.loadProjectFile(file);
    } else {
      this.setStatus('Error: Please drop an STL or MFP file');
    }
  }

  /**
   * Loads the bundled sample model, so the first thing a visitor sees is a
   * sliced model they can scrub and export rather than an empty viewport and
   * a request to go find an STL.
   *
   * Goes through the ordinary file path, so there is no second way to open a
   * model to keep working. Failure is silent on purpose: the empty state is
   * already the right thing to show, and an error about a file the visitor
   * never asked for would only be noise.
   */
  private async loadSampleModel(): Promise<void> {
    try {
      // Relative, like the favicon, so the build drops on any host path
      const response = await fetch('./sample/benchy-low-poly.stl');
      if (!response.ok) return;

      const blob = await response.blob();
      await this.loadSTLFile(new File([blob], SAMPLE_MODEL_NAME, { type: 'model/stl' }));
      this.setStatus('Sample model loaded. Drop your own STL to replace it, or press ? for help');
    } catch {
      // Leaves the empty state up, which already says how to load a model
    }
  }

  private async loadSTLFile(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.stl')) {
      this.setStatus('Error: Please select an STL file');
      return;
    }

    // Extract filename without extension for use as project name
    this.currentProjectName = file.name.replace(/\.stl$/i, '');

    this.setStatus(`Loading ${file.name}...`);
    this.showProgress('Loading model...', 0);

    try {
      const mesh = await this.viewer3D.loadSTL(file);
      this.currentMesh = mesh;

      this.setStatus(`Loaded ${file.name}`);
      this.setMeshStats(mesh);

      this.hideProgress();
    } catch (error) {
      this.setStatus(`Error loading file: ${error}`);
      this.hideProgress();
    }
  }

  private handleModelLoaded(mesh: IndexedMesh): void {
    this.currentMesh = mesh;
    this.slicer = new Slicer(mesh);
    this.rodTool.clearRods();
    this.controlPanel.updateRodList([]);
    this.showModelLoadedUI();

    // Set model center for symmetry
    const centerX = (mesh.boundingBox.min.x + mesh.boundingBox.max.x) / 2;
    const centerY = (mesh.boundingBox.min.y + mesh.boundingBox.max.y) / 2;
    this.rodTool.setModelCenter(centerX, centerY);
    this.viewer3D.setSymmetryCenter(centerX, centerY);

    // Enable save button
    this.saveProjectBtn.disabled = false;

    // A project load restores its own settings first and then slices once
    // itself, so don't slice here with the outgoing config.
    if (this.loadingProject) return;

    // A fresh model opens on a mid-model cross-section rather than the
    // featureless bottom footprint of layer 1.
    this.pendingThreeQuarterLayer = true;

    // Initial slice
    this.reslice();
  }

  private handleThicknessChange(_thickness: number): void {
    this.reslice();
  }

  private handleLayerChange(layerIndex: number): void {
    if (!this.sliceResult || !this.slicer) return;

    const config = this.controlPanel.getSliceConfig();
    const slice = this.slicer.sliceSingleLayer(layerIndex, config);

    if (slice) {
      this.currentSlice = slice;
      const preview = this.withStagedRodHoles(slice);
      this.lastRenderedHoleKey = this.rodHoleKey(preview.rodHoles);
      this.layerPreview.render(preview);
      this.viewer3D.setSlicePlaneHeight(slice.zHeight);
      this.viewer3D.highlightFloatingSections(slice, this.controlPanel.getShowFloating());
    }
  }

  /**
   * The layer as the 2D preview should show it. Two sets of holes are missing
   * from the slicer's own output: rod edits are staged until Apply, and the
   * rod under the cursor has not been placed at all. Both are punched into a
   * copy of the layer here, which is why only the layer on screen is ever
   * computed: it is one point-in-contour test per rod.
   *
   * Gated on the same switch as the 3D placement rings, so one control covers
   * live rod feedback in both views.
   */
  private withStagedRodHoles(slice: Slice): Slice {
    if (!this.currentMesh || !this.controlPanel.getLiveIntersections()) return slice;

    const staged = this.rodTool.hasPending();
    if (!staged && this.placementPreviewPositions.length === 0) return slice;

    const { min, max } = this.currentMesh.boundingBox;
    const holesFor = (rods: AlignmentRod[]) =>
      previewRodHoles(rods, slice.contours, slice.zHeight, min.z, max.z);

    // With nothing staged the slice's own holes are already right, and they
    // are the accurate ones, so only the cursor's rods are added to them.
    const placed = staged ? holesFor(this.rodTool.getRods()) : slice.rodHoles;

    return { ...slice, rodHoles: [...placed, ...holesFor(this.placementPreviewRods())] };
  }

  /** The rods the cursor is currently aiming, as a new rod would be created. */
  private placementPreviewRods(): AlignmentRod[] {
    const diameter = this.rodTool.getRodDiameter();
    return this.placementPreviewPositions.map((position, index) => ({
      id: `placement-preview-${index}`,
      position: { ...position },
      diameter,
      bottomZ: 0,
      topZ: 1,
    }));
  }

  /**
   * Redraws the previewed layer after a rod moved, keeping pan and zoom. The
   * hole positions are compared first: this runs on every cursor move in
   * placement mode, and most of those moves change nothing in this layer.
   */
  private refreshLayerPreview(): void {
    if (!this.currentSlice) return;

    const preview = this.withStagedRodHoles(this.currentSlice);
    const key = this.rodHoleKey(preview.rodHoles);
    if (key === this.lastRenderedHoleKey) return;

    this.lastRenderedHoleKey = key;
    this.layerPreview.refresh(preview);
  }

  private rodHoleKey(holes: RodHole[]): string {
    return holes
      .map(hole => `${hole.center.x.toFixed(3)},${hole.center.y.toFixed(3)},${hole.diameter}`)
      .join(';');
  }

  private handleShowFloatingChange(show: boolean): void {
    if (this.currentSlice) {
      this.viewer3D.highlightFloatingSections(this.currentSlice, show);
    }
  }

  private handleViewModeChanged(mode: 'original' | 'slices'): void {
    const icon3d = this.viewModeBtn.querySelector('.icon-3d') as SVGElement;
    const iconSlices = this.viewModeBtn.querySelector('.icon-slices') as SVGElement;

    if (mode === 'original') {
      icon3d.style.display = 'block';
      iconSlices.style.display = 'none';
    } else {
      icon3d.style.display = 'none';
      iconSlices.style.display = 'block';
    }
  }

  private handleRodPlaced(x: number, y: number): void {
    if (!this.rodTool.isToolActive()) return;

    this.rodTool.addRod(x, y);
    this.setStatus(`Placed rod at (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }

  private handleRodSelected(rodId: string | null): void {
    this.rodTool.selectRod(rodId);
    this.viewer3D.selectRod(rodId);

    // Update control panel selection and slider
    const rod = rodId ? this.rodTool.getRodById(rodId) : null;
    this.controlPanel.setSelectedRod(rodId, rod?.diameter);
    this.controlPanel.updateRodList(this.rodTool.getRods(), this.rodTool.hasPending(), rodId);
  }

  private handleSelectedRodDiameterChange(rodId: string, diameter: number): void {
    this.rodTool.updateRodDiameter(rodId, diameter);
    this.viewer3D.updateAlignmentRods(this.rodTool.getRods());
    this.controlPanel.updateRodList(this.rodTool.getRods(), this.rodTool.hasPending(), rodId);
    this.refreshLayerPreview();
  }

  private handleDeleteRod(rodId: string): void {
    this.rodTool.removeRod(rodId);
  }

  private handleRodVisibilityToggle(rodId: string): void {
    this.rodTool.toggleRodVisibility(rodId);
    this.viewer3D.updateAlignmentRods(this.rodTool.getRods());
    this.controlPanel.updateRodList(this.rodTool.getRods(), this.rodTool.hasPending(), this.rodTool.getSelectedRodId());
  }

  private handleRodMoved(rodId: string, dx: number, dy: number, dz: number): void {
    this.rodTool.moveRod(rodId, dx, dy, dz);
    // Update the visual immediately, but don't reslice until Apply is clicked
    this.viewer3D.updateAlignmentRods(this.rodTool.getRods());
    this.controlPanel.updateRodList(this.rodTool.getRods(), this.rodTool.hasPending(), this.rodTool.getSelectedRodId());
    this.refreshLayerPreview();
  }

  private handleRodHeightAdjusted(rodId: string, adjustBottom: boolean, delta: number): void {
    this.rodTool.adjustRodHeight(rodId, adjustBottom, delta);
    // Update the visual immediately, but don't reslice until Apply is clicked
    this.viewer3D.updateAlignmentRods(this.rodTool.getRods());
    this.controlPanel.updateRodList(this.rodTool.getRods(), this.rodTool.hasPending(), this.rodTool.getSelectedRodId());
    this.refreshLayerPreview();
  }

  private handleApplyRodChanges(): void {
    if (!this.rodTool.hasPending()) return;

    const rods = this.rodTool.getRods();
    if (this.slicer) {
      this.slicer.setAlignmentRods(rods);
      this.reslice();
    }
    this.rodTool.clearPendingChanges();
    this.controlPanel.setRodChangesPending(false);
  }

  private handleRodsChanged(rods: AlignmentRod[]): void {
    this.controlPanel.updateRodList(rods, this.rodTool.hasPending(), this.rodTool.getSelectedRodId());
    this.viewer3D.updateAlignmentRods(rods);
    this.refreshLayerPreview();
    // Don't auto-reslice - user must click "Apply Rod Changes"
  }

  /**
   * Re-slices the model. The work is deferred so the progress overlay can
   * paint first, so anything that depends on the new sliceResult must go in
   * `onComplete` rather than after the call.
   */
  private reslice(onComplete?: () => void): void {
    if (!this.slicer || !this.currentMesh) {
      onComplete?.();
      return;
    }

    const config = this.controlPanel.getSliceConfig();

    // Remember current layer to restore after reslicing
    const previousLayer = this.layerNavigator.getCurrentLayer();

    this.showProgress('Slicing model...', 0);

    // Use setTimeout to allow UI to update
    setTimeout(() => {
      try {
        this.sliceResult = this.slicer!.slice(config, {
          simplifyContours: true,
          detectOverhangs: true,
        });

        // Update layer navigator
        this.layerNavigator.setLayerCount(
          this.sliceResult.layerCount,
          config.thickness,
          this.currentMesh!.boundingBox.min.z
        );

        // Update slice stack visualization
        this.viewer3D.updateSliceStack(this.sliceResult);

        // Enable export
        this.controlPanel.setExportEnabled(this.sliceResult.layerCount > 0);
        this.downloadCurrentSVGBtn.disabled = this.sliceResult.layerCount === 0;

        // Pick the layer to show: an explicit one-shot override wins, then
        // the 3/4 default for a new model, otherwise keep where the user was.
        if (this.sliceResult.slices.length > 0) {
          const lastLayer = this.sliceResult.layerCount - 1;
          let layerToShow: number;

          if (this.initialLayerOverride !== null) {
            layerToShow = Math.min(Math.max(0, this.initialLayerOverride), lastLayer);
          } else if (this.pendingThreeQuarterLayer) {
            layerToShow = Math.floor(lastLayer * 0.75);
          } else {
            layerToShow = Math.min(previousLayer, lastLayer);
          }

          this.layerNavigator.setCurrentLayer(layerToShow);
          this.handleLayerChange(layerToShow);
        }

        this.initialLayerOverride = null;
        this.pendingThreeQuarterLayer = false;

        this.setStatus(
          `Sliced into ${this.sliceResult.layerCount} layers | ` +
          `Thickness: ${config.thickness.toFixed(2)}mm`
        );

        this.hideProgress();
        onComplete?.();
      } catch (error) {
        this.setStatus(`Slicing error: ${error}`);
        this.hideProgress();
        onComplete?.();
      }
    }, 10);
  }

  private updateExportConfig(): void {
    const config = this.controlPanel.getExportConfig();
    this.svgExporter.setConfig(config);
    this.zipExporter.setConfig(config);
    this.layerPreview.setConfig(config);

    if (this.currentSlice) {
      const preview = this.withStagedRodHoles(this.currentSlice);
      this.lastRenderedHoleKey = this.rodHoleKey(preview.rodHoles);
      this.layerPreview.render(preview);
    }
  }

  private exportCurrentSVG(): void {
    if (!this.currentSlice || !this.sliceResult) return;

    this.svgExporter.downloadSlice(this.currentSlice, this.sliceResult.boundingBox);
    this.setStatus('SVG exported');
  }

  private async exportAllZIP(): Promise<void> {
    if (!this.sliceResult) return;

    this.showProgress('Exporting ZIP...', 0);

    try {
      await this.zipExporter.downloadZip(
        this.sliceResult.slices,
        this.sliceResult.boundingBox,
        `${this.currentProjectName}_layers.zip`,
        (progress) => {
          this.showProgress(progress.message, (progress.current / progress.total) * 100);
        }
      );

      this.setStatus('ZIP exported successfully');
    } catch (error) {
      this.setStatus(`Export error: ${error}`);
    }

    this.hideProgress();
  }

  private async exportPacked(): Promise<void> {
    if (!this.sliceResult) return;

    // Reset cancellation flag
    this.packingCancelled = false;

    try {
      // Get packing configuration from control panel
      const exportConfig = this.controlPanel.getExportConfig();
      const packingConfig = this.controlPanel.getPackingConfig();

      const config: PackingConfig = {
        paperWidth: exportConfig.paperSize.width,
        paperHeight: exportConfig.paperSize.height,
        pieceSpacing: packingConfig.pieceSpacing,
        rotationSteps: packingConfig.rotationSteps,
        numberHeight: packingConfig.numberHeight,
        margin: exportConfig.margin,
        strokeWidth: exportConfig.strokeWidth,
        showLabelCut: exportConfig.showLabelCut,
        fastMode: packingConfig.fastMode,
      };

      this.packedSVGExporter.setConfig(config);

      // Extract pieces from slices
      this.setStatus('Packing pieces...');
      const pieces = extractPiecesFromSlices(this.sliceResult.slices);

      if (pieces.length === 0) {
        this.setStatus('No pieces to pack');
        return;
      }

      // Start timer and show packing progress
      this.showPackingProgress();

      // Pack pieces onto sheets using worker
      const result = await this.packerWorkerClient.packPieces(pieces, config, (current, total, sheets) => {
        this.updatePackingProgress(current, total, sheets);
      });

      // Hide packing progress
      this.hidePackingProgress();

      // Check if cancelled
      if (this.packingCancelled) {
        this.setStatus('Packing cancelled');
        return;
      }

      if (result.sheets.length === 0) {
        this.setStatus('Could not pack any pieces');
        return;
      }

      // Export as ZIP with blocking overlay
      this.showProgress('Generating SVGs...', 0);
      await this.packedSVGExporter.downloadAllSheets(result.sheets, `${this.currentProjectName}_packed.zip`);
      this.hideProgress();

      const totalUtilization = result.sheets.reduce((sum: number, s) => sum + s.utilization, 0) / result.sheets.length;
      const elapsedTime = this.formatElapsedTime(Date.now() - this.packingStartTime);
      this.setStatus(
        `Packed ${result.totalPieces} pieces onto ${result.sheets.length} sheets ` +
        `(${(totalUtilization * 100).toFixed(0)}% utilization) in ${elapsedTime}` +
        (result.unplacedPieces.length > 0 ? ` - ${result.unplacedPieces.length} pieces too large` : '')
      );
    } catch (error) {
      this.hidePackingProgress();
      this.hideProgress();
      if (!this.packingCancelled) {
        this.setStatus(`Packing error: ${error}`);
      }
    }
  }

  private cancelPacking(): void {
    this.packingCancelled = true;
    this.packerWorkerClient.terminate();
    this.hidePackingProgress();
    this.setStatus('Packing cancelled');
  }

  private async handleSaveProject(): Promise<void> {
    if (!this.currentMesh) {
      this.setStatus('No model to save');
      return;
    }

    this.showProgress('Saving project...', 0);

    try {
      const exportConfig = this.controlPanel.getExportConfig();
      const packingConfig = this.controlPanel.getPackingConfig();

      const state: ProjectState = {
        model: this.currentMesh,
        rods: this.rodTool.getRods(),
        sliceConfig: this.controlPanel.getSliceConfig(),
        exportConfig: {
          paperSize: (document.getElementById('paper-size') as HTMLSelectElement).value,
          customPaperWidth: exportConfig.paperSize.name === 'Custom' ? exportConfig.paperSize.width : undefined,
          customPaperHeight: exportConfig.paperSize.name === 'Custom' ? exportConfig.paperSize.height : undefined,
          scale: exportConfig.scale,
          showLabelCut: exportConfig.showLabelCut,
        },
        packingConfig: {
          pieceSpacing: packingConfig.pieceSpacing,
          numberHeight: packingConfig.numberHeight,
          fastMode: packingConfig.fastMode,
        },
        uiState: {
          showFloating: this.controlPanel.getShowFloating(),
          rodDiameter: this.controlPanel.getRodDiameter(),
          currentLayer: this.layerNavigator.getCurrentLayer(),
        },
      };

      const project = createProject(state);
      await saveProject(project, `${this.currentProjectName}.mfp`);

      this.setStatus(`Project saved as ${this.currentProjectName}.mfp`);
    } catch (error) {
      this.setStatus(`Error saving project: ${error}`);
    }

    this.hideProgress();
  }

  private async loadProjectFile(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.mfp')) {
      this.setStatus('Error: Please select an MFP file');
      return;
    }

    // Extract filename without extension for use as project name
    this.currentProjectName = file.name.replace(/\.mfp$/i, '');

    this.setStatus(`Loading project ${file.name}...`);
    this.showProgress('Loading project...', 0);

    try {
      const project = await loadProject(file);
      this.showProgress('Restoring model...', 30);

      // Convert project model to IndexedMesh
      const mesh = projectToIndexedMesh(project.model);

      // handleModelLoaded fires synchronously from loadFromIndexedMesh; this
      // stops it slicing with the settings we are about to replace.
      this.loadingProject = true;
      try {
        this.viewer3D.loadFromIndexedMesh(mesh);
      } finally {
        this.loadingProject = false;
      }
      this.currentMesh = mesh;
      this.slicer = new Slicer(mesh);

      this.showProgress('Restoring settings...', 60);

      // Restore slice config
      this.controlPanel.setSliceConfig(project.sliceConfig);

      // Restore export config
      this.controlPanel.setExportConfig(project.exportConfig);

      // Restore packing config
      this.controlPanel.setPackingConfig(project.packingConfig);

      // Restore UI state
      this.controlPanel.setShowFloating(project.uiState.showFloating);
      this.controlPanel.setRodDiameter(project.uiState.rodDiameter);
      this.rodTool.setRodDiameter(project.uiState.rodDiameter);
      this.viewer3D.setPreviewDiameter(project.uiState.rodDiameter);

      // Restore rods
      this.rodTool.setRods(project.rods);
      if (this.slicer) {
        this.slicer.setAlignmentRods(project.rods);
      }

      this.showProgress('Slicing model...', 80);

      // Enable save button
      this.saveProjectBtn.disabled = false;

      // Update export config in exporters
      this.updateExportConfig();

      // Reslice with the restored config. The saved layer is applied inside
      // reslice via initialLayerOverride - reading sliceResult straight after
      // this call would race the deferred slicing and silently do nothing.
      this.initialLayerOverride = project.uiState.currentLayer;
      this.reslice(() => {
        this.setMeshStats(mesh);
        this.setStatus(
          `Loaded project ${this.currentProjectName}.mfp | ${project.rods.length} rods`
        );
        this.hideProgress();
      });
    } catch (error) {
      this.setStatus(`Error loading project: ${error}`);
      this.hideProgress();
    }
  }

  private setStatus(message: string): void {
    this.statusBar.textContent = message;
  }

  /**
   * Mesh stats live in their own slot on the right of the status bar so a
   * later status message no longer wipes the model info.
   */
  private setMeshStats(mesh: IndexedMesh): void {
    const stats = getMeshStats(mesh);
    this.statusStats.textContent =
      `${stats.triangleCount.toLocaleString()} triangles · ` +
      `${stats.dimensions.width.toFixed(1)} × ${stats.dimensions.height.toFixed(1)} × ${stats.dimensions.depth.toFixed(1)} mm`;
  }

  /** Swaps the viewport call-to-action for the real UI once a model exists. */
  private showModelLoadedUI(): void {
    this.emptyState.classList.add('hidden');
    this.previewPanel.classList.remove('hidden');
  }

  private showProgress(message: string, percent: number): void {
    this.progressText.textContent = message;
    this.progressFill.style.width = `${percent}%`;
    this.progressOverlay.classList.remove('hidden');
  }

  private hideProgress(): void {
    this.progressOverlay.classList.add('hidden');
  }

  private showPackingProgress(): void {
    this.packingStartTime = Date.now();
    this.packingProgressFill.style.width = '0%';
    this.packingProgressText.textContent = '0/0 pieces, 0 sheets';
    this.packingProgressTime.textContent = '0:00';
    this.packingProgress.classList.add('visible');

    // Start timer that updates every 100ms
    this.packingTimerInterval = window.setInterval(() => {
      this.updatePackingTime();
    }, 100);
  }

  private updatePackingProgress(current: number, total: number, sheets: number): void {
    const percent = total > 0 ? (current / total) * 100 : 0;
    this.packingProgressFill.style.width = `${percent}%`;
    this.packingProgressText.textContent = `${current}/${total} pieces, ${sheets} sheet${sheets !== 1 ? 's' : ''}`;
  }

  private hidePackingProgress(): void {
    this.packingProgress.classList.remove('visible');
    if (this.packingTimerInterval !== null) {
      clearInterval(this.packingTimerInterval);
      this.packingTimerInterval = null;
    }
  }

  private updatePackingTime(): void {
    const elapsed = Date.now() - this.packingStartTime;
    this.packingProgressTime.textContent = this.formatElapsedTime(elapsed);
  }

  private formatElapsedTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}
