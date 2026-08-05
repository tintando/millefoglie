import { AlignmentRod, createRod, reflect } from '../types/rod';

export interface RodToolEvents {
  onRodsChanged?: (rods: AlignmentRod[]) => void;
  onActiveChanged?: (active: boolean) => void;
  onRodUpdated?: (rod: AlignmentRod) => void;
}

export class RodTool {
  private rods: AlignmentRod[] = [];
  private selectedRodId: string | null = null;
  private isActive: boolean = false;
  private rodDiameter: number = 1.5;
  private events: RodToolEvents = {};
  private toolButton: HTMLButtonElement;
  private hasPendingChanges: boolean = false;
  private symmetryEnabled: boolean = false;
  private symmetryAxis: 'x' | 'y' = 'x';
  private modelCenter: { x: number; y: number } | null = null;

  constructor() {
    this.toolButton = document.getElementById('rod-tool-btn') as HTMLButtonElement;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.toolButton.addEventListener('click', () => {
      this.toggleActive();
    });
  }

  setEvents(events: RodToolEvents): void {
    this.events = events;
  }

  toggleActive(): void {
    this.isActive = !this.isActive;
    this.toolButton.classList.toggle('active', this.isActive);
    if (this.events.onActiveChanged) {
      this.events.onActiveChanged(this.isActive);
    }
  }

  setActive(active: boolean): void {
    this.isActive = active;
    this.toolButton.classList.toggle('active', active);
  }

  isToolActive(): boolean {
    return this.isActive;
  }

  setRodDiameter(diameter: number): void {
    this.rodDiameter = diameter;
  }

  getRodDiameter(): number {
    return this.rodDiameter;
  }

  addRod(x: number, y: number): AlignmentRod[] {
    const rods: AlignmentRod[] = [];
    const rod = createRod(x, y, this.rodDiameter);
    this.rods.push(rod);
    rods.push(rod);

    if (this.symmetryEnabled && this.modelCenter) {
      const center = this.symmetryAxis === 'y' ? this.modelCenter.x : this.modelCenter.y;
      const mx = this.symmetryAxis === 'y' ? reflect(x, center) : x;
      const my = this.symmetryAxis === 'x' ? reflect(y, center) : y;
      const mirroredRod = createRod(mx, my, this.rodDiameter);

      // Two-way link, so a later edit to either rod drives the other one.
      rod.mirror = { partnerId: mirroredRod.id, axis: this.symmetryAxis, center };
      mirroredRod.mirror = { partnerId: rod.id, axis: this.symmetryAxis, center };

      this.rods.push(mirroredRod);
      rods.push(mirroredRod);
    }

    this.hasPendingChanges = true;
    this.notifyChange();
    return rods;
  }

  setSymmetryEnabled(enabled: boolean): void {
    this.symmetryEnabled = enabled;
  }

  setSymmetryAxis(axis: 'x' | 'y'): void {
    this.symmetryAxis = axis;
  }

  setModelCenter(x: number, y: number): void {
    this.modelCenter = { x, y };
  }

  isSymmetryEnabled(): boolean {
    return this.symmetryEnabled;
  }

  getSymmetryAxis(): 'x' | 'y' {
    return this.symmetryAxis;
  }

  getModelCenter(): { x: number; y: number } | null {
    return this.modelCenter;
  }

  /**
   * Copies a rod onto its mirror partner: position reflected across the pair's
   * mirror line, everything else matched outright. Called after every edit so a
   * symmetric pair can never drift apart, and so clamping applied to one rod
   * (height limits, for instance) lands on both.
   *
   * Returns the partner if one was updated, so callers can report it.
   */
  private syncMirror(rod: AlignmentRod): AlignmentRod | null {
    const mirror = rod.mirror;
    if (!mirror) return null;

    const partner = this.rods.find(r => r.id === mirror.partnerId);
    if (!partner) {
      // Partner is gone (deleted, or a project saved before pairing existed).
      delete rod.mirror;
      return null;
    }

    if (mirror.axis === 'y') {
      partner.position.x = reflect(rod.position.x, mirror.center);
      partner.position.y = rod.position.y;
    } else {
      partner.position.x = rod.position.x;
      partner.position.y = reflect(rod.position.y, mirror.center);
    }

    partner.bottomZ = rod.bottomZ;
    partner.topZ = rod.topZ;
    partner.diameter = rod.diameter;

    return partner;
  }

  /** Drops the mirror link from a rod's partner, leaving it independent. */
  private unlinkMirror(rod: AlignmentRod): void {
    if (!rod.mirror) return;
    const partner = this.rods.find(r => r.id === rod.mirror!.partnerId);
    if (partner) {
      delete partner.mirror;
    }
  }

  removeRod(rodId: string): void {
    const index = this.rods.findIndex(r => r.id === rodId);
    if (index !== -1) {
      this.unlinkMirror(this.rods[index]);
      this.rods.splice(index, 1);
      if (this.selectedRodId === rodId) {
        this.selectedRodId = null;
      }
      this.hasPendingChanges = true;
      this.notifyChange();
    }
  }

  moveRod(rodId: string, dx: number, dy: number, dz: number): void {
    const rod = this.rods.find(r => r.id === rodId);
    if (!rod) return;

    // dx, dy are position changes in world units
    // dz is height adjustment (0-1 range for bottomZ/topZ)
    rod.position.x += dx;
    rod.position.y += dy;

    // dz adjusts both bottom and top (positive = move rod up, negative = move down)
    if (dz !== 0) {
      // Move the whole rod up/down
      rod.bottomZ = Math.max(0, Math.min(1, rod.bottomZ + dz));
      rod.topZ = Math.max(rod.bottomZ + 0.05, Math.min(1, rod.topZ + dz));
    }

    const partner = this.syncMirror(rod);
    this.hasPendingChanges = true;

    if (this.events.onRodUpdated) {
      this.events.onRodUpdated(rod);
      if (partner) this.events.onRodUpdated(partner);
    }
    // Don't call notifyChange() here - movement updates are handled separately
    // and don't trigger immediate reslicing (user must click Apply)
  }

  adjustRodHeight(rodId: string, adjustBottom: boolean, delta: number): void {
    const rod = this.rods.find(r => r.id === rodId);
    if (!rod) return;

    if (adjustBottom) {
      rod.bottomZ = Math.max(0, Math.min(rod.topZ - 0.05, rod.bottomZ + delta));
    } else {
      rod.topZ = Math.max(rod.bottomZ + 0.05, Math.min(1, rod.topZ + delta));
    }

    const partner = this.syncMirror(rod);
    this.hasPendingChanges = true;

    if (this.events.onRodUpdated) {
      this.events.onRodUpdated(rod);
      if (partner) this.events.onRodUpdated(partner);
    }
    // Don't call notifyChange() - user must click Apply to reslice
  }

  updateRodDiameter(rodId: string, diameter: number): void {
    const rod = this.rods.find(r => r.id === rodId);
    if (!rod) return;

    rod.diameter = diameter;
    const partner = this.syncMirror(rod);
    this.hasPendingChanges = true;

    if (this.events.onRodUpdated) {
      this.events.onRodUpdated(rod);
      if (partner) this.events.onRodUpdated(partner);
    }
  }

  toggleRodVisibility(rodId: string): void {
    const rod = this.rods.find(r => r.id === rodId);
    if (!rod) return;

    rod.hidden = !rod.hidden;
  }

  selectRod(rodId: string | null): void {
    this.selectedRodId = rodId;
  }

  getSelectedRod(): AlignmentRod | null {
    if (!this.selectedRodId) return null;
    return this.rods.find(r => r.id === this.selectedRodId) || null;
  }

  getSelectedRodId(): string | null {
    return this.selectedRodId;
  }

  getRods(): AlignmentRod[] {
    return [...this.rods];
  }

  getRodById(rodId: string): AlignmentRod | undefined {
    return this.rods.find(r => r.id === rodId);
  }

  clearRods(): void {
    this.rods = [];
    this.selectedRodId = null;
    this.hasPendingChanges = false;
    this.notifyChange();
  }

  setRods(rods: AlignmentRod[]): void {
    // Copy position too - a shallow spread would keep sharing it with the
    // caller's array (the slicer holds the same one after a project load), so
    // dragging a rod would edit the slice input before Apply was pressed.
    this.rods = rods.map(rod => ({ ...rod, position: { ...rod.position } }));
    this.selectedRodId = null;
    this.hasPendingChanges = false;
    this.notifyChange();
  }

  hasPending(): boolean {
    return this.hasPendingChanges;
  }

  clearPendingChanges(): void {
    this.hasPendingChanges = false;
  }

  private notifyChange(): void {
    if (this.events.onRodsChanged) {
      this.events.onRodsChanged(this.getRods());
    }
  }
}
