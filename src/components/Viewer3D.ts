import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { IndexedMesh, BoundingBox } from '../types/geometry';
import { Slice, SliceResult } from '../types/slice';
import { AlignmentRod } from '../types/rod';
import { bufferGeometryToIndexedMesh, centerMesh } from '../core/MeshProcessor';
import { bvhManager } from '../core/BVHManager';
import { ResolvedTheme } from '../ui/ThemeManager';
import { isInputFocused, isModalOpen } from '../ui/domUtils';

export type ViewMode = 'original' | 'slices';
export type NavMode = 'orbit' | 'fly';
export type ViewPreset = 'top' | 'front' | 'right' | 'left' | 'back' | 'iso';

/** Draws the rod gizmo after everything else, so it stays on top of the model. */
const GIZMO_RENDER_ORDER = 999;

/**
 * A rod position to test against the model, without needing a rod to exist.
 * bottomZ/topZ are the usual 0-1 fractions of model height.
 */
interface RodProbe {
  x: number;
  y: number;
  diameter: number;
  bottomZ: number;
  topZ: number;
}

/**
 * Scene colours that follow the UI theme. Semantic colours - the slice plane,
 * floating highlights, rod states and gizmo axes - deliberately stay out of
 * here: they carry meaning and must read the same in both themes.
 */
const VIEWER_THEME: Record<ResolvedTheme, {
  background: number;
  gridMain: number;
  gridSub: number;
  ambientIntensity: number;
  model: number;
  intersectionSphere: number;
}> = {
  dark: {
    background: 0x0f0f1a,
    gridMain: 0x444444,
    gridSub: 0x222222,
    ambientIntensity: 0.5,
    model: 0x4a90d9,
    intersectionSphere: 0xff3366,
  },
  light: {
    background: 0xe9e4da,
    gridMain: 0xa79d8c,
    gridSub: 0xc6bdae,
    ambientIntensity: 1.1,
    model: 0x2f74b8,
    intersectionSphere: 0xd6234f,
  },
};

/**
 * Pool of pre-allocated geometries for intersection visualization.
 * Reuses ring and sphere geometries to avoid GC pauses during drag.
 */
class IntersectionGeometryPool {
  private ringPool: THREE.Mesh[] = [];
  private spherePool: THREE.Mesh[] = [];
  private arcPool: THREE.Mesh[] = [];
  private ringIndex = 0;
  private sphereIndex = 0;
  private arcIndex = 0;

  // Shared geometries (created once, reused)
  private fullRingGeometry: THREE.RingGeometry | null = null;
  private sphereGeometry: THREE.SphereGeometry | null = null;

  // Materials (shared to reduce memory)
  private greenRingMaterial: THREE.MeshBasicMaterial;
  private redArcMaterial: THREE.MeshBasicMaterial;
  private greenArcMaterial: THREE.MeshBasicMaterial;
  private sphereMaterial: THREE.MeshBasicMaterial;

  constructor() {
    this.greenRingMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff44,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      depthWrite: false,
    });
    this.redArcMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      depthWrite: false,
    });
    this.greenArcMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff44,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      depthWrite: false,
    });
    this.sphereMaterial = new THREE.MeshBasicMaterial({
      color: 0xff3366,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
  }

  /**
   * Materials here are shared singletons already handed to live meshes, so the
   * theme is applied in place rather than by rebuilding the pool.
   */
  setTheme(theme: ResolvedTheme): void {
    this.sphereMaterial.color.setHex(VIEWER_THEME[theme].intersectionSphere);
  }

  reset(): void {
    this.ringIndex = 0;
    this.sphereIndex = 0;
    this.arcIndex = 0;
  }

  getFullRing(innerRadius: number, _outerRadius: number): THREE.Mesh {
    // Create or reuse ring (outerRadius is implicitly scaled with innerRadius)
    if (this.ringIndex < this.ringPool.length) {
      const ring = this.ringPool[this.ringIndex++];
      // Update geometry scale to match requested radii
      ring.scale.set(innerRadius / 0.95, innerRadius / 0.95, 1);
      ring.visible = true;
      return ring;
    }

    // Create new ring with normalized geometry
    if (!this.fullRingGeometry) {
      this.fullRingGeometry = new THREE.RingGeometry(0.95, 1.15, 32);
    }
    const ring = new THREE.Mesh(this.fullRingGeometry, this.greenRingMaterial);
    ring.scale.set(innerRadius / 0.95, innerRadius / 0.95, 1);
    ring.renderOrder = 998;
    this.ringPool.push(ring);
    this.ringIndex++;
    return ring;
  }

  getSphere(radius: number): THREE.Mesh {
    if (this.sphereIndex < this.spherePool.length) {
      const sphere = this.spherePool[this.sphereIndex++];
      sphere.scale.setScalar(radius / 0.2);
      sphere.visible = true;
      return sphere;
    }

    // Create new sphere with normalized geometry
    if (!this.sphereGeometry) {
      this.sphereGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    }
    const sphere = new THREE.Mesh(this.sphereGeometry, this.sphereMaterial);
    sphere.scale.setScalar(radius / 0.2);
    sphere.renderOrder = 999;
    this.spherePool.push(sphere);
    this.sphereIndex++;
    return sphere;
  }

  getArc(innerRadius: number, outerRadius: number, startAngle: number, arcAngle: number, isInside: boolean): THREE.Mesh {
    // Arcs need unique geometry per shape, so we create them but can reuse mesh objects
    const segments = Math.max(3, Math.ceil(arcAngle * 8));
    const arcGeometry = new THREE.RingGeometry(innerRadius, outerRadius, segments, 1, startAngle, arcAngle);

    if (this.arcIndex < this.arcPool.length) {
      const arc = this.arcPool[this.arcIndex++];
      arc.geometry.dispose();
      arc.geometry = arcGeometry;
      arc.material = isInside ? this.greenArcMaterial : this.redArcMaterial;
      arc.visible = true;
      return arc;
    }

    const arc = new THREE.Mesh(arcGeometry, isInside ? this.greenArcMaterial : this.redArcMaterial);
    arc.renderOrder = 998;
    this.arcPool.push(arc);
    this.arcIndex++;
    return arc;
  }

  hideUnused(): void {
    // Hide all unused meshes
    for (let i = this.ringIndex; i < this.ringPool.length; i++) {
      this.ringPool[i].visible = false;
    }
    for (let i = this.sphereIndex; i < this.spherePool.length; i++) {
      this.spherePool[i].visible = false;
    }
    for (let i = this.arcIndex; i < this.arcPool.length; i++) {
      this.arcPool[i].visible = false;
    }
  }

  getAllMeshes(): THREE.Mesh[] {
    return [...this.ringPool, ...this.spherePool, ...this.arcPool];
  }

  dispose(): void {
    this.fullRingGeometry?.dispose();
    this.sphereGeometry?.dispose();
    this.greenRingMaterial.dispose();
    this.redArcMaterial.dispose();
    this.greenArcMaterial.dispose();
    this.sphereMaterial.dispose();

    for (const mesh of this.arcPool) {
      mesh.geometry.dispose();
    }

    this.ringPool = [];
    this.spherePool = [];
    this.arcPool = [];
  }
}

export interface Viewer3DEvents {
  onModelLoaded?: (mesh: IndexedMesh, geometry: THREE.BufferGeometry) => void;
  onRodPlaced?: (x: number, y: number) => void;
  /**
   * Where the rods being aimed would land, mirrored one included, or an empty
   * array once nothing is being aimed. Lets the 2D preview show their holes
   * before the click that commits them.
   */
  onPlacementPreviewMoved?: (positions: Array<{ x: number; y: number }>) => void;
  onRodSelected?: (rodId: string | null) => void;
  onRodMoved?: (rodId: string, dx: number, dy: number, dz: number) => void;
  onRodHeightAdjusted?: (rodId: string, adjustBottom: boolean, delta: number) => void;
  onViewModeChanged?: (mode: ViewMode) => void;
  onNavModeChanged?: (mode: NavMode) => void;
}

export class Viewer3D {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  // Camera controls state (shared by both nav modes)
  private moveForward = false;
  private moveBackward = false;
  private moveLeft = false;
  private moveRight = false;
  private moveUp = false;
  private moveDown = false;
  private isMouseLooking = false;
  private yaw = 0;   // Rotation around Z axis (horizontal look)
  private pitch = 0; // Rotation around X axis (vertical look)
  private velocity = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private baseSpeed = 100; // Base movement speed
  private moveSpeed = 100;
  private mouseSensitivity = 0.002;
  private prevTime = performance.now();
  private modelScale = 1;

  // Orbit state. In orbit mode the camera is derived from target/distance plus
  // yaw/pitch; in fly mode the position is free and target/distance are only
  // recomputed when switching back.
  private navMode: NavMode = 'orbit';
  private target = new THREE.Vector3();
  private distance = 100;
  // Damping targets - animate() eases the live values toward these
  private targetYaw = 0;
  private targetPitch = 0;
  private targetDistance = 100;
  private desiredTarget = new THREE.Vector3();
  private readonly ORBIT_DAMPING = 12;        // higher = snappier
  private readonly ORBIT_SENSITIVITY = 0.008; // radians per pixel dragged
  private readonly MIN_DISTANCE_FACTOR = 0.02;
  private readonly MAX_DISTANCE_FACTOR = 20;

  // Click-vs-drag arbitration for the left button. dragExceededThreshold is
  // sticky for the whole press, so dragging away and back still counts as a
  // drag rather than firing a stray click.
  private pointerDownPos = { x: 0, y: 0 };
  private pointerDownButton = -1;
  private isOrbiting = false;
  private isPanning = false;
  private dragExceededThreshold = false;
  private readonly DRAG_THRESHOLD_PX = 5;

  private theme: ResolvedTheme = 'dark';
  private ambientLight: THREE.AmbientLight | null = null;

  // Rod gizmo
  private rodGizmo: THREE.Group | null = null;
  private gizmoArrows: Map<string, THREE.Group> = new Map();
  private draggingAxis: string | null = null;
  private hoveredAxis: string | null = null;
  private dragStartPoint = new THREE.Vector3();
  private dragPlane = new THREE.Plane();
  private arrowBaseColors: Map<string, number> = new Map();

  // Model state
  private modelMesh: THREE.Mesh | null = null;
  private sliceStackGroup: THREE.Group | null = null;
  private slicePlane: THREE.Mesh | null = null;
  private gridHelper: THREE.GridHelper | null = null;
  private floatingOverlay: THREE.Mesh | null = null;
  private rodMeshes: Map<string, THREE.Mesh> = new Map();
  private rodIntersectionGroup: THREE.Group | null = null;
  private selectedRodIntersectionGroup: THREE.Group | null = null;
  private currentSliceResult: SliceResult | null = null;
  private events: Viewer3DEvents = {};
  private boundingBox: BoundingBox | null = null;
  private rodPlacementMode = false;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private selectedRodId: string | null = null;

  // CSS2D renderer for rod labels
  private css2DRenderer: CSS2DRenderer;
  private rodLabels: Map<string, CSS2DObject> = new Map();

  // View mode
  private viewMode: ViewMode = 'original';
  private currentSlicePlaneZ: number | null = null;

  // Performance optimization state
  private isDraggingRod = false;
  private intersectionGeometryPool: IntersectionGeometryPool;
  private lastIntersectionUpdateTime = 0;
  private readonly INTERSECTION_THROTTLE_MS = 33; // ~30fps during drag
  private pendingIntersectionUpdate = false;

  // Preview rod state
  private previewRodMesh: THREE.Mesh | null = null;
  private symmetryPreviewMesh: THREE.Mesh | null = null;
  private previewRodDiameter: number = 1.5;
  private lastPreviewUpdateTime = 0;
  private readonly PREVIEW_THROTTLE_MS = 50; // ~20fps for preview
  // Its own pool, so the preview and a selected rod can both show rings
  private placementIntersectionGroup: THREE.Group | null = null;
  private placementIntersectionPool: IntersectionGeometryPool;
  private liveIntersections = true;

  // Symmetry state
  private symmetryEnabled: boolean = false;
  private symmetryAxis: 'x' | 'y' = 'x';
  private symmetryCenter: { x: number; y: number } | null = null;

  constructor(container: HTMLElement, theme: ResolvedTheme = 'dark') {
    this.container = container;
    this.theme = theme;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.intersectionGeometryPool = new IntersectionGeometryPool();
    this.intersectionGeometryPool.setTheme(theme);
    this.placementIntersectionPool = new IntersectionGeometryPool();
    this.placementIntersectionPool.setTheme(theme);

    const palette = VIEWER_THEME[theme];

    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(palette.background);

    // Create camera - Z is up in this application
    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      10000
    );
    this.camera.up.set(0, 0, 1); // Z is up
    this.camera.position.set(0, -100, 50);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Create CSS2D renderer for labels
    this.css2DRenderer = new CSS2DRenderer();
    this.css2DRenderer.setSize(container.clientWidth, container.clientHeight);
    this.css2DRenderer.domElement.style.position = 'absolute';
    this.css2DRenderer.domElement.style.top = '0';
    this.css2DRenderer.domElement.style.left = '0';
    this.css2DRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.css2DRenderer.domElement);

    // Add lights
    this.ambientLight = new THREE.AmbientLight(0x404040, palette.ambientIntensity);
    this.scene.add(this.ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(100, 100, 100);
    this.scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-100, 100, -100);
    this.scene.add(directionalLight2);

    // Setup controls
    this.setupCameraControls();

    // Handle resize
    window.addEventListener('resize', this.onResize.bind(this));

    // Start animation loop
    this.animate();
  }

  private setupCameraControls(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousedown', (e) => this.onPointerDown(e));

    // Use document for mouseup/mousemove to catch drags that leave the canvas
    document.addEventListener('mouseup', (e) => this.onPointerUp(e));
    document.addEventListener('mousemove', (e) => this.onPointerMove(e));

    canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));

    // Hover detection and preview update on canvas
    canvas.addEventListener('mousemove', (e) => {
      if (!this.draggingAxis && !this.isMouseLooking && !this.isOrbiting && !this.isPanning) {
        this.updateGizmoHover(e);
        this.updatePreviewRod(e);
      }
    });

    // Prevent context menu on right click
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Keyboard controls
    document.addEventListener('keydown', (e) => {
      if (isInputFocused() || isModalOpen()) return;
      // Let browser/app chords through - otherwise Ctrl+S would also latch
      // moveBackward and the camera would drift once focus moved away. Bare
      // Ctrl still has to reach the switch below: it is fly mode's descend key,
      // and its own keydown naturally carries ctrlKey.
      const isBareControlKey = e.code === 'ControlLeft' || e.code === 'ControlRight';
      if ((e.ctrlKey || e.metaKey) && !isBareControlKey) return;

      const rodMoveStep = this.modelScale * 0.05; // 5% of model size per keypress

      switch (e.code) {
        // Movement (fly mode)
        case 'KeyW': this.moveForward = true; break;
        case 'KeyS': this.moveBackward = true; break;
        case 'KeyA': this.moveLeft = true; break;
        case 'KeyD': this.moveRight = true; break;
        case 'Space': this.moveUp = true; e.preventDefault(); break;
        case 'ControlLeft':
        case 'ControlRight': this.moveDown = true; break;

        // View toggle
        case 'KeyV': this.toggleViewMode(); break;

        // Camera
        case 'KeyF': this.frameModel(); break;
        case 'KeyC': this.setNavMode(this.navMode === 'orbit' ? 'fly' : 'orbit'); break;
        case 'Digit1': this.setViewPreset('front'); break;
        case 'Digit2': this.setViewPreset('right'); break;
        case 'Digit3': this.setViewPreset('top'); break;
        case 'Digit4': this.setViewPreset('iso'); break;

        // Rod movement (I/J/K for X/Y/Z like Blender's G+axis)
        case 'KeyI': // Move rod along X
          if (this.selectedRodId && this.events.onRodMoved) {
            const dir = e.shiftKey ? -1 : 1;
            this.events.onRodMoved(this.selectedRodId, rodMoveStep * dir, 0, 0);
          }
          break;
        case 'KeyJ': // Move rod along Y
          if (this.selectedRodId && this.events.onRodMoved) {
            const dir = e.shiftKey ? -1 : 1;
            this.events.onRodMoved(this.selectedRodId, 0, rodMoveStep * dir, 0);
          }
          break;
        case 'KeyK': // Move rod along Z (adjust height)
          if (this.selectedRodId && this.events.onRodMoved) {
            const dir = e.shiftKey ? -1 : 1;
            this.events.onRodMoved(this.selectedRodId, 0, 0, 0.05 * dir); // 5% height adjustment
          }
          break;
      }
    });

    document.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW': this.moveForward = false; break;
        case 'KeyS': this.moveBackward = false; break;
        case 'KeyA': this.moveLeft = false; break;
        case 'KeyD': this.moveRight = false; break;
        case 'Space': this.moveUp = false; break;
        case 'ControlLeft':
        case 'ControlRight': this.moveDown = false; break;
      }
    });

    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  // ---------------------------------------------------------------------
  // Pointer handling
  // ---------------------------------------------------------------------

  private onPointerDown(event: MouseEvent): void {
    this.pointerDownPos = { x: event.clientX, y: event.clientY };
    this.pointerDownButton = event.button;
    this.dragExceededThreshold = false;

    // The gizmo always wins the left button when a rod is selected
    if (event.button === 0 && this.tryStartGizmoDrag(event)) {
      return;
    }

    if (this.navMode === 'fly') {
      if (event.button === 2) {
        this.isMouseLooking = true;
        this.renderer.domElement.requestPointerLock();
      }
      return;
    }

    // Orbit mode. Right-drag orbits and middle-drag pans, in rod placement
    // mode and out of it, so the camera never changes buttons under the user.
    // That leaves the left button doing nothing but clicking - select a rod,
    // or place one - with no drag meaning to tell it apart from.
    if (event.button === 2) {
      this.isOrbiting = true;
      event.preventDefault();
    } else if (event.button === 1) {
      this.isPanning = true;
      event.preventDefault();
    } else if (event.button === 0 && event.shiftKey) {
      this.isPanning = true;
    }
  }

  private onPointerMove(event: MouseEvent): void {
    // Handle gizmo dragging (works even outside canvas)
    if (this.draggingAxis) {
      this.handleGizmoDrag(event);
      return;
    }

    if (!this.dragExceededThreshold && this.pointerDownButton >= 0) {
      const dx = event.clientX - this.pointerDownPos.x;
      const dy = event.clientY - this.pointerDownPos.y;
      if (Math.hypot(dx, dy) > this.DRAG_THRESHOLD_PX) {
        this.dragExceededThreshold = true;
      }
    }

    if (this.navMode === 'fly') {
      if (document.pointerLockElement === this.renderer.domElement || this.isMouseLooking) {
        // Yaw rotates around Z (world up), pitch rotates around local X
        this.yaw -= event.movementX * this.mouseSensitivity;
        this.pitch -= event.movementY * this.mouseSensitivity;
        this.pitch = this.clampPitch(this.pitch);
        this.targetYaw = this.yaw;
        this.targetPitch = this.pitch;
        this.updateCameraRotation();
      }
      return;
    }

    if (this.isPanning) {
      this.panCamera(event.movementX, event.movementY);
    } else if (this.isOrbiting) {
      this.targetYaw -= event.movementX * this.ORBIT_SENSITIVITY;
      this.targetPitch = this.clampPitch(this.targetPitch - event.movementY * this.ORBIT_SENSITIVITY);
    }
  }

  private onPointerUp(event: MouseEvent): void {
    // Read before stopGizmoDrag clears it, otherwise a short gizmo drag would
    // also register as a click and deselect the rod being edited.
    const wasGizmoDragging = this.draggingAxis !== null;

    if (event.button === 2) {
      this.isMouseLooking = false;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    if (event.button === 0) {
      this.stopGizmoDrag();
    }

    // A left press that never crossed the drag threshold is a click, even if
    // it was held for a while - the camera provably did not move.
    if (event.button === 0 &&
        this.pointerDownButton === 0 &&
        !this.dragExceededThreshold &&
        !wasGizmoDragging &&
        this.isEventOnCanvas(event)) {
      this.handleClick(event);
    }

    if (event.button === this.pointerDownButton) {
      this.pointerDownButton = -1;
    }
    this.isOrbiting = false;
    this.isPanning = false;
  }

  private onDoubleClick(event: MouseEvent): void {
    if (this.navMode !== 'orbit' || !this.modelMesh) return;

    this.setMouseFromEvent(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const hits = this.raycaster.intersectObject(this.modelMesh);
    if (hits.length > 0) {
      this.desiredTarget.copy(hits[0].point);
    }
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();

    if (this.navMode === 'fly') {
      // Fly mode keeps the original behaviour: the wheel trims move speed
      const speedMultiplier = event.deltaY > 0 ? 0.9 : 1.1;
      this.moveSpeed = Math.max(this.baseSpeed * 0.1, Math.min(this.baseSpeed * 5, this.moveSpeed * speedMultiplier));
      return;
    }

    this.dollyTowardCursor(event);
  }

  private isEventOnCanvas(event: MouseEvent): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right &&
           event.clientY >= rect.top && event.clientY <= rect.bottom;
  }

  private setMouseFromEvent(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private clampPitch(pitch: number): number {
    return Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
  }

  /** Translates the orbit target in the camera's screen plane. */
  private panCamera(dxPixels: number, dyPixels: number): void {
    const height = this.renderer.domElement.clientHeight || 1;
    // World units covered by one pixel at the target's depth
    const worldPerPixel = (2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.distance) / height;

    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());

    const offset = right.multiplyScalar(-dxPixels * worldPerPixel)
      .add(up.multiplyScalar(dyPixels * worldPerPixel));

    // Applied undamped so the model tracks the cursor exactly
    this.target.add(offset);
    this.desiredTarget.copy(this.target);
  }

  /**
   * Zooms toward whatever is under the pointer: shortens the orbit distance
   * and slides the target toward the cursor ray by the same proportion.
   */
  private dollyTowardCursor(event: WheelEvent): void {
    const zoomFactor = event.deltaY > 0 ? 1.1 : 1 / 1.1;
    // Never let the target cross the near plane, which would clip a small model
    const minDistance = Math.max(this.camera.near * 2, this.modelScale * this.MIN_DISTANCE_FACTOR);
    const maxDistance = this.modelScale * this.MAX_DISTANCE_FACTOR;
    const newDistance = Math.max(minDistance, Math.min(maxDistance, this.targetDistance * zoomFactor));

    // Only pull the target when actually zooming in, and only by the fraction
    // of the distance we just removed.
    const shrink = 1 - newDistance / this.targetDistance;
    if (shrink > 0) {
      this.setMouseFromEvent(event);
      this.raycaster.setFromCamera(this.mouse, this.camera);

      // Plane through the target facing the camera
      const viewDir = new THREE.Vector3();
      this.camera.getWorldDirection(viewDir);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir, this.desiredTarget);

      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(plane, hit)) {
        this.desiredTarget.lerp(hit, shrink);
      }
    }

    this.targetDistance = newDistance;
  }

  private updateCameraRotation(): void {
    // Build rotation: first yaw around Z (world up), then pitch around local X
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch);
    // Camera looks along -Y by default when Z is up, so we need a base rotation
    const qBase = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    this.camera.quaternion.copy(qYaw).multiply(qPitch).multiply(qBase);
  }

  /** Unit vector the camera looks along, for the current yaw/pitch. */
  private getForward(): THREE.Vector3 {
    const cosPitch = Math.cos(this.pitch);
    return new THREE.Vector3(
      -Math.sin(this.yaw) * cosPitch,
      Math.cos(this.yaw) * cosPitch,
      Math.sin(this.pitch)
    );
  }

  /** Places the camera on the orbit sphere around the target. */
  private updateOrbitPosition(): void {
    this.camera.position.copy(this.target).addScaledVector(this.getForward(), -this.distance);
  }

  // ---------------------------------------------------------------------
  // Navigation mode / framing / presets
  // ---------------------------------------------------------------------

  setNavMode(mode: NavMode): void {
    if (mode === this.navMode) return;

    if (mode === 'orbit') {
      // Adopt a target straight ahead of where the camera already is, so the
      // switch does not visibly move anything.
      this.distance = Math.max(this.distance, this.modelScale * 0.1);
      this.targetDistance = this.distance;
      this.target.copy(this.camera.position).addScaledVector(this.getForward(), this.distance);
      this.desiredTarget.copy(this.target);
      this.targetYaw = this.yaw;
      this.targetPitch = this.pitch;
    }

    this.navMode = mode;

    // Drop any half-finished gesture from the previous mode
    this.isOrbiting = false;
    this.isPanning = false;
    this.isMouseLooking = false;
    this.moveForward = this.moveBackward = this.moveLeft = this.moveRight = false;
    this.moveUp = this.moveDown = false;
    this.velocity.set(0, 0, 0);
    if (document.pointerLockElement) document.exitPointerLock();

    if (this.events.onNavModeChanged) {
      this.events.onNavModeChanged(mode);
    }
  }

  getNavMode(): NavMode {
    return this.navMode;
  }

  /**
   * Distance at which the model's bounding sphere just fills the frame.
   * Accounts for both FOV and aspect, so wide models no longer overflow the
   * sides the way the old fixed 1.5x-size heuristic let them.
   */
  private computeFrameDistance(boundingBox: BoundingBox): number {
    const sx = boundingBox.max.x - boundingBox.min.x;
    const sy = boundingBox.max.y - boundingBox.min.y;
    const sz = boundingBox.max.z - boundingBox.min.z;
    const radius = Math.max(1e-6, Math.hypot(sx, sy, sz) / 2);

    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fitVertical = radius / Math.sin(vFov / 2);
    const fitHorizontal = radius / Math.sin(hFov / 2);

    return Math.max(fitVertical, fitHorizontal) * 1.05; // small breathing room
  }

  /** Zoom-to-fit: re-frames the model without changing the viewing angle. */
  frameModel(): void {
    if (!this.boundingBox) return;
    this.applyFraming(this.boundingBox);
  }

  private applyFraming(boundingBox: BoundingBox): void {
    const size = Math.max(
      boundingBox.max.x - boundingBox.min.x,
      boundingBox.max.y - boundingBox.min.y,
      boundingBox.max.z - boundingBox.min.z
    );

    // Store model scale for rod movement
    this.modelScale = size;

    this.desiredTarget.set(
      (boundingBox.min.x + boundingBox.max.x) / 2,
      (boundingBox.min.y + boundingBox.max.y) / 2,
      (boundingBox.min.z + boundingBox.max.z) / 2
    );
    this.targetDistance = this.computeFrameDistance(boundingBox);

    // Set movement speed based on model size (faster for larger models)
    this.baseSpeed = size * 2;
    this.moveSpeed = this.baseSpeed;

    if (this.navMode === 'fly') {
      // Fly mode owns its position, so place the camera directly
      this.target.copy(this.desiredTarget);
      this.distance = this.targetDistance;
      this.updateCameraRotation();
      this.updateOrbitPosition();
    }
  }

  /** Frames a freshly loaded model from the default front-above angle. */
  private frameNewModel(boundingBox: BoundingBox): void {
    this.targetYaw = 0;
    this.targetPitch = -0.49; // ~28 degrees above the horizon, matching the old framing
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;

    this.applyFraming(boundingBox);

    // Snap rather than easing in - there is nothing to ease from on load
    this.target.copy(this.desiredTarget);
    this.distance = this.targetDistance;
    this.updateCameraRotation();
    this.updateOrbitPosition();
  }

  setViewPreset(preset: ViewPreset): void {
    // yaw 0 puts the camera on -Y looking toward +Y; negative pitch looks down
    const angles: Record<ViewPreset, { yaw: number; pitch: number }> = {
      front: { yaw: 0, pitch: 0 },
      back: { yaw: Math.PI, pitch: 0 },
      right: { yaw: Math.PI / 2, pitch: 0 },
      left: { yaw: -Math.PI / 2, pitch: 0 },
      top: { yaw: 0, pitch: -Math.PI / 2 + 0.01 },
      iso: { yaw: Math.PI / 4, pitch: -Math.atan(1 / Math.SQRT2) },
    };

    const { yaw, pitch } = angles[preset];
    this.targetYaw = yaw;
    this.targetPitch = this.clampPitch(pitch);

    if (this.boundingBox) {
      this.applyFraming(this.boundingBox);
    }

    if (this.navMode === 'fly') {
      this.yaw = this.targetYaw;
      this.pitch = this.targetPitch;
      this.updateCameraRotation();
      this.updateOrbitPosition();
    }
  }

  setTheme(theme: ResolvedTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;

    const palette = VIEWER_THEME[theme];
    (this.scene.background as THREE.Color).setHex(palette.background);

    if (this.ambientLight) {
      this.ambientLight.intensity = palette.ambientIntensity;
    }
    if (this.modelMesh) {
      (this.modelMesh.material as THREE.MeshPhongMaterial).color.setHex(palette.model);
    }
    this.intersectionGeometryPool.setTheme(theme);
    this.placementIntersectionPool.setTheme(theme);

    // GridHelper bakes its colours into vertex data, so it has to be rebuilt
    if (this.boundingBox) {
      this.updateGrid(this.boundingBox);
    }
  }

  private handleClick(event: MouseEvent): void {
    if (!this.modelMesh) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Always check for rod selection first
    const rodMeshArray = Array.from(this.rodMeshes.values());
    if (rodMeshArray.length > 0) {
      const rodIntersects = this.raycaster.intersectObjects(rodMeshArray);
      if (rodIntersects.length > 0) {
        const rodId = rodIntersects[0].object.userData.rodId;
        if (this.events.onRodSelected) {
          // Toggle selection: deselect if clicking already selected rod
          if (rodId === this.selectedRodId) {
            this.events.onRodSelected(null);
          } else {
            this.events.onRodSelected(rodId);
          }
        }
        return;
      }
    }

    // Only place new rod if in placement mode
    if (this.rodPlacementMode && this.boundingBox) {
      // Raycast to the base plane (Z = boundingBox.min.z) to get X,Y position
      const basePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.boundingBox.min.z);
      const intersectPoint = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(basePlane, intersectPoint)) {
        if (this.events.onRodPlaced) {
          this.events.onRodPlaced(intersectPoint.x, intersectPoint.y);
        }
      }
    } else if (!this.rodPlacementMode) {
      // Click on empty space - deselect current rod
      if (this.selectedRodId && this.events.onRodSelected) {
        this.events.onRodSelected(null);
      }
    }
  }

  private tryStartGizmoDrag(event: MouseEvent): boolean {
    if (!this.rodGizmo || !this.selectedRodId) return false;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Collect only mesh objects from gizmo arrows for raycasting
    const gizmoMeshes: THREE.Mesh[] = [];
    this.gizmoArrows.forEach((arrowGroup, axisName) => {
      arrowGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.userData.arrowType = axisName;
          gizmoMeshes.push(child);
        }
      });
    });

    const intersects = this.raycaster.intersectObjects(gizmoMeshes, false);
    if (intersects.length > 0) {
      const arrowType = intersects[0].object.userData.arrowType as string;
      if (arrowType) {
        this.draggingAxis = arrowType;
        this.dragStartPoint.copy(intersects[0].point);

        // Set up drag plane based on axis
        const rod = this.getRodDataById(this.selectedRodId);
        if (rod && this.boundingBox) {
          const modelHeight = this.boundingBox.max.z - this.boundingBox.min.z;
          const rodCenterZ = this.boundingBox.min.z + ((rod.bottomZ + rod.topZ) / 2) * modelHeight;

          if (arrowType === 'x') {
            // Drag along X axis - plane normal is Y
            this.dragPlane.setFromNormalAndCoplanarPoint(
              new THREE.Vector3(0, 1, 0),
              new THREE.Vector3(rod.position.x, rod.position.y, rodCenterZ)
            );
          } else if (arrowType === 'y') {
            // Drag along Y axis - plane normal is X
            this.dragPlane.setFromNormalAndCoplanarPoint(
              new THREE.Vector3(1, 0, 0),
              new THREE.Vector3(rod.position.x, rod.position.y, rodCenterZ)
            );
          } else if (arrowType === 'top' || arrowType === 'bottom') {
            // Drag along Z axis - use a vertical plane facing the camera
            const cameraDir = new THREE.Vector3();
            this.camera.getWorldDirection(cameraDir);
            // Project to XY plane for the normal
            const planeNormal = new THREE.Vector3(cameraDir.x, cameraDir.y, 0);
            if (planeNormal.length() < 0.1) {
              // Camera looking straight up/down, use Y as fallback
              planeNormal.set(0, 1, 0);
            } else {
              planeNormal.normalize();
            }
            this.dragPlane.setFromNormalAndCoplanarPoint(
              planeNormal,
              this.dragStartPoint
            );
          }
        }

        this.renderer.domElement.style.cursor = 'grabbing';
        // Ensure arrow is highlighted while dragging
        this.setArrowHighlight(arrowType, true);
        this.isDraggingRod = true;
        return true;
      }
    }
    return false;
  }

  private handleGizmoDrag(event: MouseEvent): void {
    if (!this.draggingAxis || !this.selectedRodId) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersectPoint = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.dragPlane, intersectPoint)) {
      const delta = intersectPoint.clone().sub(this.dragStartPoint);

      if (this.draggingAxis === 'x' && this.events.onRodMoved) {
        this.events.onRodMoved(this.selectedRodId, delta.x, 0, 0);
        this.dragStartPoint.x = intersectPoint.x;
      } else if (this.draggingAxis === 'y' && this.events.onRodMoved) {
        this.events.onRodMoved(this.selectedRodId, 0, delta.y, 0);
        this.dragStartPoint.y = intersectPoint.y;
      } else if (this.draggingAxis === 'top' && this.events.onRodHeightAdjusted && this.boundingBox) {
        const modelHeight = this.boundingBox.max.z - this.boundingBox.min.z;
        const deltaZ = delta.z / modelHeight; // Convert to 0-1 range
        this.events.onRodHeightAdjusted(this.selectedRodId, false, deltaZ);
        this.dragStartPoint.z = intersectPoint.z;
      } else if (this.draggingAxis === 'bottom' && this.events.onRodHeightAdjusted && this.boundingBox) {
        const modelHeight = this.boundingBox.max.z - this.boundingBox.min.z;
        const deltaZ = delta.z / modelHeight; // Convert to 0-1 range
        this.events.onRodHeightAdjusted(this.selectedRodId, true, deltaZ);
        this.dragStartPoint.z = intersectPoint.z;
      }
    }
  }

  private stopGizmoDrag(): void {
    if (this.draggingAxis) {
      // Remove highlight from dragged arrow
      this.setArrowHighlight(this.draggingAxis, false);
      this.draggingAxis = null;
      this.hoveredAxis = null;
      this.renderer.domElement.style.cursor = this.rodPlacementMode ? 'crosshair' : 'default';

      // End dragging and trigger full-quality intersection update
      if (this.isDraggingRod) {
        this.isDraggingRod = false;
        // Force full-quality update when drag ends
        if (this.selectedRodId) {
          this.showSelectedRodIntersection(this.selectedRodId, false);
        }
      }
    }
  }

  setEvents(events: Viewer3DEvents): void {
    this.events = events;
  }

  setRodPlacementMode(enabled: boolean): void {
    this.rodPlacementMode = enabled;
    this.renderer.domElement.style.cursor = enabled ? 'crosshair' : 'default';

    if (enabled) {
      this.createPreviewRod();
    } else {
      this.hidePreviewRod();
    }
  }

  /**
   * Turns the placement-time intersection rings on or off. They cost a fan of
   * raycasts on every cursor move and fade the model while you aim, which is
   * not always wanted, so it is a user setting rather than always-on.
   */
  setLiveIntersections(enabled: boolean): void {
    this.liveIntersections = enabled;
    if (!enabled) {
      this.hidePlacementIntersection();
    }
  }

  setPreviewDiameter(diameter: number): void {
    this.previewRodDiameter = diameter;
    if (this.previewRodMesh && this.boundingBox) {
      // Recreate preview with new diameter
      this.createPreviewRod();
    }
  }

  setSymmetryEnabled(enabled: boolean): void {
    this.symmetryEnabled = enabled;
    if (this.symmetryPreviewMesh) {
      this.symmetryPreviewMesh.visible = enabled && this.rodPlacementMode;
    }
  }

  setSymmetryAxis(axis: 'x' | 'y'): void {
    this.symmetryAxis = axis;
  }

  setSymmetryCenter(x: number, y: number): void {
    this.symmetryCenter = { x, y };
  }

  private createPreviewRod(): void {
    this.hidePreviewRod();

    if (!this.boundingBox) return;

    const modelHeight = this.boundingBox.max.z - this.boundingBox.min.z;
    const geometry = new THREE.CylinderGeometry(
      this.previewRodDiameter / 2,
      this.previewRodDiameter / 2,
      modelHeight,
      32
    );
    geometry.rotateX(Math.PI / 2);

    const material = new THREE.MeshPhongMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.4,
      depthTest: true,
      depthWrite: false,
    });

    this.previewRodMesh = new THREE.Mesh(geometry, material);
    this.previewRodMesh.visible = false;
    this.scene.add(this.previewRodMesh);

    // Create symmetry preview rod
    const symmetryGeometry = new THREE.CylinderGeometry(
      this.previewRodDiameter / 2,
      this.previewRodDiameter / 2,
      modelHeight,
      32
    );
    symmetryGeometry.rotateX(Math.PI / 2);

    const symmetryMaterial = new THREE.MeshPhongMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.3,
      depthTest: true,
      depthWrite: false,
    });

    this.symmetryPreviewMesh = new THREE.Mesh(symmetryGeometry, symmetryMaterial);
    this.symmetryPreviewMesh.visible = false;
    this.scene.add(this.symmetryPreviewMesh);
  }

  private hidePreviewRod(): void {
    this.hidePlacementIntersection();
    this.events.onPlacementPreviewMoved?.([]);

    if (this.previewRodMesh) {
      this.scene.remove(this.previewRodMesh);
      this.previewRodMesh.geometry.dispose();
      (this.previewRodMesh.material as THREE.Material).dispose();
      this.previewRodMesh = null;
    }
    if (this.symmetryPreviewMesh) {
      this.scene.remove(this.symmetryPreviewMesh);
      this.symmetryPreviewMesh.geometry.dispose();
      (this.symmetryPreviewMesh.material as THREE.Material).dispose();
      this.symmetryPreviewMesh = null;
    }
  }

  private updatePreviewRod(event: MouseEvent): void {
    if (!this.rodPlacementMode || !this.previewRodMesh || !this.modelMesh || !this.boundingBox) return;

    // Throttle updates
    const now = performance.now();
    if (now - this.lastPreviewUpdateTime < this.PREVIEW_THROTTLE_MS) return;
    this.lastPreviewUpdateTime = now;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Raycast to base plane to get X,Y position
    const basePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.boundingBox.min.z);
    const intersectPoint = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(basePlane, intersectPoint)) {
      const modelHeight = this.boundingBox.max.z - this.boundingBox.min.z;

      this.previewRodMesh.position.set(
        intersectPoint.x,
        intersectPoint.y,
        this.boundingBox.min.z + modelHeight / 2
      );
      this.previewRodMesh.visible = true;

      // Rings for every rod about to be placed, the mirrored one included -
      // symmetry only helps if both ends land in solid material.
      const probes = [{ x: intersectPoint.x, y: intersectPoint.y }];

      // Check if position is valid (simple check: inside model bounds)
      const isValid = this.isPreviewPositionValid(intersectPoint.x, intersectPoint.y);
      const material = this.previewRodMesh.material as THREE.MeshPhongMaterial;
      material.color.setHex(isValid ? 0xffaa00 : 0xff4444);

      // Update symmetry preview
      if (this.symmetryPreviewMesh && this.symmetryEnabled && this.symmetryCenter) {
        const mx = this.symmetryAxis === 'y'
          ? 2 * this.symmetryCenter.x - intersectPoint.x
          : intersectPoint.x;
        const my = this.symmetryAxis === 'x'
          ? 2 * this.symmetryCenter.y - intersectPoint.y
          : intersectPoint.y;

        this.symmetryPreviewMesh.position.set(
          mx,
          my,
          this.boundingBox.min.z + modelHeight / 2
        );
        this.symmetryPreviewMesh.visible = true;

        // Check if symmetry position is valid
        const isSymmetryValid = this.isPreviewPositionValid(mx, my);
        const symmetryMaterial = this.symmetryPreviewMesh.material as THREE.MeshPhongMaterial;
        symmetryMaterial.color.setHex(isSymmetryValid ? 0xffaa00 : 0xff4444);

        probes.push({ x: mx, y: my });
      } else if (this.symmetryPreviewMesh) {
        this.symmetryPreviewMesh.visible = false;
      }

      this.showPlacementIntersection(probes);
      this.events.onPlacementPreviewMoved?.(probes);
    } else {
      this.previewRodMesh.visible = false;
      if (this.symmetryPreviewMesh) {
        this.symmetryPreviewMesh.visible = false;
      }
      this.hidePlacementIntersection();
      this.events.onPlacementPreviewMoved?.([]);
    }
  }

  private isPreviewPositionValid(x: number, y: number): boolean {
    if (!this.boundingBox || !this.modelMesh) return false;

    // Simple check: count intersections from above
    const rayDirection = new THREE.Vector3(0, 0, -1);
    this.raycaster.set(
      new THREE.Vector3(x, y, this.boundingBox.max.z + 10),
      rayDirection
    );

    const intersects = this.raycaster.intersectObject(this.modelMesh);
    // Valid if ray hits the model (at least one intersection)
    return intersects.length > 0;
  }

  toggleViewMode(): void {
    this.viewMode = this.viewMode === 'original' ? 'slices' : 'original';
    this.updateViewMode();
    if (this.events.onViewModeChanged) {
      this.events.onViewModeChanged(this.viewMode);
    }
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.updateViewMode();
  }

  getViewMode(): ViewMode {
    return this.viewMode;
  }

  private updateViewMode(): void {
    if (this.modelMesh) {
      this.modelMesh.visible = this.viewMode === 'original';
    }
    if (this.sliceStackGroup) {
      this.sliceStackGroup.visible = this.viewMode === 'slices';
      // Apply slice visibility filtering based on plane height
      if (this.viewMode === 'slices') {
        this.updateSliceVisibility();
      } else {
        // Reset all slices to visible when not in slice view
        this.sliceStackGroup.children.forEach((child) => {
          if (child instanceof THREE.Mesh) {
            child.visible = true;
          }
        });
        // Reset rod geometries to full height
        this.resetRodGeometries();
      }
    }

    // Show/hide purple rings based on view mode
    if (this.rodIntersectionGroup) {
      if (this.viewMode === 'original') {
        // Show all rings in original view
        this.rodIntersectionGroup.children.forEach((child) => {
          if (child instanceof THREE.Mesh) {
            child.visible = true;
          }
        });
      }
    }
  }

  private resetRodGeometries(): void {
    if (!this.boundingBox) return;

    for (const [rodId, mesh] of this.rodMeshes) {
      const rod = this.getRodDataById(rodId);
      if (!rod) continue;

      const modelHeight = this.boundingBox.max.z - this.boundingBox.min.z;
      const rodBottomZ = this.boundingBox.min.z + rod.bottomZ * modelHeight;
      const rodTopZ = this.boundingBox.min.z + rod.topZ * modelHeight;
      const rodHeight = rodTopZ - rodBottomZ;

      // Respect manually hidden rods
      mesh.visible = !rod.hidden;
      mesh.geometry.dispose();
      const geometry = new THREE.CylinderGeometry(
        rod.diameter / 2,
        rod.diameter / 2,
        rodHeight,
        32
      );
      geometry.rotateX(Math.PI / 2);
      mesh.geometry = geometry;
      mesh.position.z = rodBottomZ + rodHeight / 2;
    }

    // Show labels (respecting hidden state)
    for (const [rodId, label] of this.rodLabels) {
      const rod = this.getRodDataById(rodId);
      label.visible = rod ? !rod.hidden : true;
    }
  }

  async loadSTL(file: File): Promise<IndexedMesh> {
    return new Promise((resolve, reject) => {
      const loader = new STLLoader();
      const reader = new FileReader();

      reader.onload = (event) => {
        try {
          const contents = event.target?.result as ArrayBuffer;
          const geometry = loader.parse(contents);

          // Convert to indexed mesh and center it
          let indexedMesh = bufferGeometryToIndexedMesh(geometry);
          indexedMesh = centerMesh(indexedMesh);

          // Recreate geometry from indexed mesh for display
          const centeredGeometry = new THREE.BufferGeometry();
          const vertexArray: number[] = [];
          for (const tri of indexedMesh.triangles) {
            const v0 = indexedMesh.vertices[tri[0]];
            const v1 = indexedMesh.vertices[tri[1]];
            const v2 = indexedMesh.vertices[tri[2]];
            vertexArray.push(v0.x, v0.y, v0.z);
            vertexArray.push(v1.x, v1.y, v1.z);
            vertexArray.push(v2.x, v2.y, v2.z);
          }
          centeredGeometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(vertexArray, 3)
          );
          centeredGeometry.computeVertexNormals();

          this.setModel(centeredGeometry, indexedMesh.boundingBox);

          if (this.events.onModelLoaded) {
            this.events.onModelLoaded(indexedMesh, centeredGeometry);
          }

          resolve(indexedMesh);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Loads a model directly from an IndexedMesh (bypasses STL parsing)
   * Used when loading from a project file
   */
  loadFromIndexedMesh(mesh: IndexedMesh): THREE.BufferGeometry {
    // Create geometry from indexed mesh
    const geometry = new THREE.BufferGeometry();
    const vertexArray: number[] = [];
    for (const tri of mesh.triangles) {
      const v0 = mesh.vertices[tri[0]];
      const v1 = mesh.vertices[tri[1]];
      const v2 = mesh.vertices[tri[2]];
      vertexArray.push(v0.x, v0.y, v0.z);
      vertexArray.push(v1.x, v1.y, v1.z);
      vertexArray.push(v2.x, v2.y, v2.z);
    }
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertexArray, 3)
    );
    geometry.computeVertexNormals();

    this.setModel(geometry, mesh.boundingBox);

    if (this.events.onModelLoaded) {
      this.events.onModelLoaded(mesh, geometry);
    }

    return geometry;
  }

  private setModel(geometry: THREE.BufferGeometry, boundingBox: BoundingBox): void {
    // Adopt the new box up front: updateGrid and the framing below both read
    // this.boundingBox, and callers used to assign it only after setModel
    // returned, so framing ran against the *previous* model's bounds.
    this.boundingBox = boundingBox;

    // Remove existing model and dispose BVH
    if (this.modelMesh) {
      bvhManager.disposeBVH(this.modelMesh.geometry);
      this.scene.remove(this.modelMesh);
      this.modelMesh.geometry.dispose();
      (this.modelMesh.material as THREE.Material).dispose();
    }

    // Compute BVH for accelerated raycasting (O(log n) instead of O(n))
    bvhManager.computeBVH(geometry);

    // Create material
    const material = new THREE.MeshPhongMaterial({
      color: VIEWER_THEME[this.theme].model,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });

    // Create mesh
    this.modelMesh = new THREE.Mesh(geometry, material);
    this.modelMesh.visible = this.viewMode === 'original';
    this.scene.add(this.modelMesh);

    // Update grid
    this.updateGrid(boundingBox);

    // Position camera to see the model
    this.frameNewModel(boundingBox);
  }

  private updateGrid(boundingBox: BoundingBox): void {
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.geometry.dispose();
      (this.gridHelper.material as THREE.Material).dispose();
    }

    const size = Math.max(
      boundingBox.max.x - boundingBox.min.x,
      boundingBox.max.y - boundingBox.min.y
    ) * 2;

    const palette = VIEWER_THEME[this.theme];
    this.gridHelper = new THREE.GridHelper(size, 20, palette.gridMain, palette.gridSub);
    this.gridHelper.rotation.x = Math.PI / 2;
    this.gridHelper.position.z = 0;
    this.scene.add(this.gridHelper);
  }

  setSlicePlaneHeight(z: number): void {
    if (!this.boundingBox) return;

    if (!this.slicePlane) {
      const geometry = new THREE.PlaneGeometry(1, 1);
      const material = new THREE.MeshBasicMaterial({
        color: 0xe94560,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
      });
      this.slicePlane = new THREE.Mesh(geometry, material);
      this.slicePlane.renderOrder = 100; // Render after slices (default 0) but before gizmos
      this.scene.add(this.slicePlane);
    }

    const width = (this.boundingBox.max.x - this.boundingBox.min.x) * 1.5;
    const height = (this.boundingBox.max.y - this.boundingBox.min.y) * 1.5;

    this.slicePlane.scale.set(width, height, 1);
    this.slicePlane.position.set(
      (this.boundingBox.min.x + this.boundingBox.max.x) / 2,
      (this.boundingBox.min.y + this.boundingBox.max.y) / 2,
      z + 0.02 // Small offset to prevent z-fighting with slices at same height
    );

    this.currentSlicePlaneZ = z;
    this.updateSliceVisibility();
  }

  private updateSliceVisibility(): void {
    if (this.currentSlicePlaneZ === null) return;

    // In slice view, hide slices above the slice plane
    if (this.viewMode === 'slices') {
      if (this.sliceStackGroup) {
        this.sliceStackGroup.children.forEach((child) => {
          if (child instanceof THREE.Mesh) {
            // Each slice mesh is positioned at slice.zHeight
            child.visible = child.position.z <= this.currentSlicePlaneZ!;
          }
        });
      }

      // Recreate purple rings respecting the new slice plane position
      this.updateRodIntersections();

      // Update selected rod intersection if any
      if (this.selectedRodId) {
        this.showSelectedRodIntersection(this.selectedRodId, true);
      }

      // Hide rod portions above the slice plane
      this.updateRodVisibilityForSliceView();
    }
  }

  private updateRodVisibilityForSliceView(): void {
    if (!this.boundingBox || this.currentSlicePlaneZ === null) return;

    for (const [rodId, mesh] of this.rodMeshes) {
      const rod = this.getRodDataById(rodId);
      if (!rod) continue;

      // Respect manually hidden rods
      if (rod.hidden) {
        mesh.visible = false;
        continue;
      }

      const modelHeight = this.boundingBox.max.z - this.boundingBox.min.z;
      const rodBottomZ = this.boundingBox.min.z + rod.bottomZ * modelHeight;
      const rodTopZ = this.boundingBox.min.z + rod.topZ * modelHeight;

      if (rodBottomZ > this.currentSlicePlaneZ) {
        // Entire rod is above the plane - hide it
        mesh.visible = false;
      } else if (rodTopZ <= this.currentSlicePlaneZ) {
        // Entire rod is below the plane - show it fully
        mesh.visible = true;
        // Reset to full height
        const rodHeight = rodTopZ - rodBottomZ;
        mesh.geometry.dispose();
        const geometry = new THREE.CylinderGeometry(
          rod.diameter / 2,
          rod.diameter / 2,
          rodHeight,
          32
        );
        geometry.rotateX(Math.PI / 2);
        mesh.geometry = geometry;
        mesh.position.z = rodBottomZ + rodHeight / 2;
      } else {
        // Rod crosses the plane - clip it
        mesh.visible = true;
        const clippedHeight = this.currentSlicePlaneZ - rodBottomZ;
        mesh.geometry.dispose();
        const geometry = new THREE.CylinderGeometry(
          rod.diameter / 2,
          rod.diameter / 2,
          clippedHeight,
          32
        );
        geometry.rotateX(Math.PI / 2);
        mesh.geometry = geometry;
        mesh.position.z = rodBottomZ + clippedHeight / 2;
      }
    }

    // Also update rod labels visibility
    for (const [rodId, label] of this.rodLabels) {
      const rod = this.getRodDataById(rodId);
      if (!rod) continue;

      // Respect manually hidden rods
      if (rod.hidden) {
        label.visible = false;
        continue;
      }

      const modelHeight = this.boundingBox.max.z - this.boundingBox.min.z;
      const rodBottomZ = this.boundingBox.min.z + rod.bottomZ * modelHeight;

      label.visible = rodBottomZ <= this.currentSlicePlaneZ;
    }
  }

  hideSlicePlane(): void {
    if (this.slicePlane) {
      this.scene.remove(this.slicePlane);
      this.slicePlane.geometry.dispose();
      (this.slicePlane.material as THREE.Material).dispose();
      this.slicePlane = null;
    }
    this.currentSlicePlaneZ = null;

    // Show all slices when plane is hidden
    if (this.sliceStackGroup) {
      this.sliceStackGroup.children.forEach((child) => {
        if (child instanceof THREE.Mesh) {
          child.visible = true;
        }
      });
    }
  }

  updateSliceStack(sliceResult: SliceResult): void {
    this.currentSliceResult = sliceResult;

    // Remove existing slice stack
    if (this.sliceStackGroup) {
      this.scene.remove(this.sliceStackGroup);
      this.sliceStackGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    }

    this.sliceStackGroup = new THREE.Group();

    const layerThickness = sliceResult.modelHeight / sliceResult.layerCount;
    const colors = [0x4a90d9, 0x50c878, 0xffa500, 0xff6b6b, 0x9b59b6];

    for (let i = 0; i < sliceResult.slices.length; i++) {
      const slice = sliceResult.slices[i];
      const color = colors[i % colors.length];

      // Collect outer contours and their holes
      const outerContours: Array<{outer: typeof slice.contours[0], holes: typeof slice.contours}> = [];

      // First pass: identify outer contours
      for (const contour of slice.contours) {
        if (!contour.isHole && contour.points.length >= 3) {
          outerContours.push({ outer: contour, holes: [] });
        }
      }

      // Second pass: assign holes to their containing outer contours
      for (const contour of slice.contours) {
        if (contour.isHole && contour.points.length >= 3) {
          // Find which outer contour contains this hole (use first point as test)
          const testPoint = contour.points[0];
          for (const outerData of outerContours) {
            if (this.pointInContour(testPoint, outerData.outer.points)) {
              outerData.holes.push(contour);
              break;
            }
          }
        }
      }

      // Create shapes with holes
      for (const { outer, holes } of outerContours) {
        const shape = new THREE.Shape();
        shape.moveTo(outer.points[0].x, outer.points[0].y);
        for (let j = 1; j < outer.points.length; j++) {
          shape.lineTo(outer.points[j].x, outer.points[j].y);
        }
        shape.closePath();

        // Add holes to the shape
        for (const hole of holes) {
          const holePath = new THREE.Path();
          holePath.moveTo(hole.points[0].x, hole.points[0].y);
          for (let j = 1; j < hole.points.length; j++) {
            holePath.lineTo(hole.points[j].x, hole.points[j].y);
          }
          holePath.closePath();
          shape.holes.push(holePath);
        }

        // Add rod holes to all shapes
        for (const rodHole of slice.rodHoles) {
          const rodPath = new THREE.Path();
          // Create circular path for rod hole
          const segments = 24;
          const radius = rodHole.diameter / 2;
          for (let s = 0; s <= segments; s++) {
            const angle = (s / segments) * Math.PI * 2;
            const x = rodHole.center.x + Math.cos(angle) * radius;
            const y = rodHole.center.y + Math.sin(angle) * radius;
            if (s === 0) {
              rodPath.moveTo(x, y);
            } else {
              rodPath.lineTo(x, y);
            }
          }
          rodPath.closePath();
          shape.holes.push(rodPath);
        }

        // Extrude to layer thickness (paper thickness simulation)
        const extrudeSettings = {
          depth: layerThickness * 0.9,
          bevelEnabled: false,
        };

        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        const material = new THREE.MeshPhongMaterial({
          color: color,
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
        });

        const mesh = new THREE.Mesh(geometry, material);
        // Position at slice height
        mesh.position.z = slice.zHeight;
        this.sliceStackGroup.add(mesh);
      }
    }

    this.sliceStackGroup.visible = this.viewMode === 'slices';
    this.scene.add(this.sliceStackGroup);

    // Update rod intersections
    this.updateRodIntersections();

    // Update selected rod intersection highlighting
    if (this.selectedRodId) {
      this.showSelectedRodIntersection(this.selectedRodId);
    }
  }

  private pointInContour(point: {x: number, y: number}, contour: Array<{x: number, y: number}>): boolean {
    // Ray casting algorithm for point-in-polygon
    let inside = false;
    const n = contour.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = contour[i].x, yi = contour[i].y;
      const xj = contour[j].x, yj = contour[j].y;
      if (((yi > point.y) !== (yj > point.y)) &&
          (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  private updateRodIntersections(): void {
    // Remove existing rod intersection visuals
    if (this.rodIntersectionGroup) {
      this.scene.remove(this.rodIntersectionGroup);
      this.rodIntersectionGroup.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
          if ('geometry' in child) child.geometry.dispose();
          if ('material' in child && child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }

    if (!this.currentSliceResult || !this.boundingBox) return;

    this.rodIntersectionGroup = new THREE.Group();

    // Create rings at each slice height for each rod hole (except selected rod and hidden rods)
    for (const slice of this.currentSliceResult.slices) {
      // In slice view, skip slices above the slice plane
      if (this.viewMode === 'slices' && this.currentSlicePlaneZ !== null) {
        if (slice.zHeight > this.currentSlicePlaneZ) continue;
      }

      for (const rodHole of slice.rodHoles) {
        // Skip rod holes for the selected rod (it has its own visualization)
        if (rodHole.rodId === this.selectedRodId) continue;

        // Skip rod holes for hidden rods
        const rod = this.getRodDataById(rodHole.rodId);
        if (rod?.hidden) continue;

        const radius = rodHole.diameter / 2;
        // Create a ring geometry for the rod intersection
        const ringGeometry = new THREE.RingGeometry(
          radius * 0.85,
          radius * 1.15,
          32
        );
        const ringMaterial = new THREE.MeshBasicMaterial({
          color: 0xff00ff,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.8,
          depthTest: false,
          depthWrite: false,
        });

        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.position.set(rodHole.center.x, rodHole.center.y, slice.zHeight + 0.1);
        ring.renderOrder = 997;

        this.rodIntersectionGroup.add(ring);
      }
    }

    this.scene.add(this.rodIntersectionGroup);
  }

  highlightFloatingSections(slice: Slice, showFloating: boolean): void {
    // Remove existing overlay
    if (this.floatingOverlay) {
      this.scene.remove(this.floatingOverlay);
      this.floatingOverlay.geometry.dispose();
      (this.floatingOverlay.material as THREE.Material).dispose();
      this.floatingOverlay = null;
    }

    if (!showFloating || slice.floatingSections.length === 0) return;

    // Create geometry for floating sections
    const shapes: THREE.Shape[] = [];

    for (const contourIndex of slice.floatingSections) {
      const contour = slice.contours[contourIndex];
      if (contour.points.length < 3) continue;

      const shape = new THREE.Shape();
      shape.moveTo(contour.points[0].x, contour.points[0].y);
      for (let i = 1; i < contour.points.length; i++) {
        shape.lineTo(contour.points[i].x, contour.points[i].y);
      }
      shape.closePath();
      shapes.push(shape);
    }

    if (shapes.length === 0) return;

    const geometry = new THREE.ShapeGeometry(shapes);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });

    this.floatingOverlay = new THREE.Mesh(geometry, material);
    this.floatingOverlay.position.z = slice.zHeight + 0.1;
    this.scene.add(this.floatingOverlay);
  }

  updateAlignmentRods(rods: AlignmentRod[]): void {
    // Remove old rod meshes
    for (const mesh of this.rodMeshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.rodMeshes.clear();

    // Remove old rod labels
    for (const label of this.rodLabels.values()) {
      this.scene.remove(label);
      label.element.remove();
    }
    this.rodLabels.clear();

    if (!this.boundingBox) return;

    const boundingBox = this.boundingBox;
    const modelHeight = boundingBox.max.z - boundingBox.min.z;

    rods.forEach((rod, index) => {
      // Calculate actual rod height based on bottomZ and topZ (0-1 range)
      const rodBottomZ = boundingBox.min.z + rod.bottomZ * modelHeight;
      const rodTopZ = boundingBox.min.z + rod.topZ * modelHeight;
      const rodHeight = rodTopZ - rodBottomZ;

      const geometry = new THREE.CylinderGeometry(
        rod.diameter / 2,
        rod.diameter / 2,
        rodHeight,
        32
      );
      geometry.rotateX(Math.PI / 2);

      const isSelected = rod.id === this.selectedRodId;
      const material = new THREE.MeshPhongMaterial({
        color: isSelected ? 0x00ff00 : 0xffaa00,
        transparent: true,
        opacity: 0.7,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        rod.position.x,
        rod.position.y,
        rodBottomZ + rodHeight / 2
      );
      mesh.userData.rodId = rod.id;
      mesh.userData.rodData = rod; // Store full rod data for gizmo

      // Apply hidden state
      if (rod.hidden) {
        mesh.visible = false;
      }

      this.scene.add(mesh);
      this.rodMeshes.set(rod.id, mesh);

      // Create CSS2D label for rod number
      const labelDiv = document.createElement('div');
      labelDiv.className = 'rod-label';
      labelDiv.textContent = String(index + 1);
      const label = new CSS2DObject(labelDiv);
      label.position.set(rod.position.x, rod.position.y, rodTopZ + 2);
      // Hide label if rod is hidden
      if (rod.hidden) {
        label.visible = false;
      }
      this.scene.add(label);
      this.rodLabels.set(rod.id, label);
    });

    // Update purple rings (respects hidden state and slice plane)
    this.updateRodIntersections();

    // Update gizmo if a rod is selected
    if (this.selectedRodId && this.rodMeshes.has(this.selectedRodId)) {
      if (this.draggingAxis) {
        // While dragging, just update positions without recreating
        this.updateGizmoPositions();
        this.updateSelectedRodIntersectionPositions();
      } else {
        this.showRodGizmo(this.selectedRodId);
        this.showSelectedRodIntersection(this.selectedRodId);
      }
    } else if (this.selectedRodId) {
      // Selected rod was removed
      this.hideRodGizmo();
      this.hideSelectedRodIntersection();
      this.selectedRodId = null;
    }
  }

  private updateGizmoPositions(): void {
    if (!this.rodGizmo || !this.selectedRodId || !this.boundingBox) return;

    const rod = this.getRodDataById(this.selectedRodId);
    if (!rod) return;

    const modelHeight = this.boundingBox.max.z - this.boundingBox.min.z;
    const rodBottomZ = this.boundingBox.min.z + rod.bottomZ * modelHeight;
    const rodTopZ = this.boundingBox.min.z + rod.topZ * modelHeight;
    const rodCenterZ = (rodBottomZ + rodTopZ) / 2;
    const rodRadius = rod.diameter / 2;

    const arrowLength = this.modelScale * 0.2;
    const topArrowLength = arrowLength * 0.8;
    const bottomArrowLength = arrowLength * 0.8;

    // Update arrow positions
    const xArrow = this.gizmoArrows.get('x');
    if (xArrow) xArrow.position.set(rod.position.x + rodRadius, rod.position.y, rodCenterZ);

    const yArrow = this.gizmoArrows.get('y');
    if (yArrow) yArrow.position.set(rod.position.x, rod.position.y + rodRadius, rodCenterZ);

    const topArrow = this.gizmoArrows.get('top');
    if (topArrow) topArrow.position.set(rod.position.x, rod.position.y, rodTopZ + topArrowLength);

    const bottomArrow = this.gizmoArrows.get('bottom');
    if (bottomArrow) bottomArrow.position.set(rod.position.x, rod.position.y, rodBottomZ - bottomArrowLength);
  }

  selectRod(rodId: string | null): void {
    this.selectedRodId = rodId;

    // Update materials to reflect selection
    for (const [id, mesh] of this.rodMeshes) {
      const material = mesh.material as THREE.MeshPhongMaterial;
      material.color.set(id === rodId ? 0x00ff00 : 0xffaa00);
    }

    // Update rod intersection rings (hides selected rod's rings)
    this.updateRodIntersections();

    // Show or hide gizmo
    if (rodId) {
      this.showRodGizmo(rodId);
      this.showSelectedRodIntersection(rodId);
    } else {
      this.hideRodGizmo();
      this.hideSelectedRodIntersection();
    }
  }

  getSelectedRodId(): string | null {
    return this.selectedRodId;
  }

  private createArrowGroup(color: number, length: number, axis: 'x' | 'y' | 'z', pointNegative: boolean = false): THREE.Group {
    // Create arrow with cylinder shaft and cone head
    // Arrow is built pointing +Y, then rotated to desired axis
    // The TIP of the arrow is at y=length (after construction)
    const group = new THREE.Group();

    const shaftRadius = length * 0.04;
    const shaftLength = length * 0.7;
    const headRadius = length * 0.12;
    const headLength = length * 0.3;

    // The gizmo is a handle, not part of the scene: it draws over the model
    // instead of disappearing inside it, so a rod placed deep in the mesh can
    // still be grabbed. Skipping the depth test alone would let the model
    // paint over the arrows, hence the render order - the transparent pass is
    // sorted by it, so the arrows go last. Picking is raycast-based and does
    // not care about any of this.
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.2,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });

    // Shaft (cylinder) - base at y=0, extends to y=shaftLength
    const shaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 12);
    const shaft = new THREE.Mesh(shaftGeometry, material.clone());
    shaft.position.y = shaftLength / 2;
    shaft.renderOrder = GIZMO_RENDER_ORDER;
    group.add(shaft);

    // Head (cone) - tip at y=length
    const headGeometry = new THREE.ConeGeometry(headRadius, headLength, 12);
    const head = new THREE.Mesh(headGeometry, material.clone());
    head.position.y = shaftLength + headLength / 2;
    head.renderOrder = GIZMO_RENDER_ORDER;
    group.add(head);

    // Store the total length for positioning calculations
    group.userData.arrowLength = length;

    // Rotate group to point along the desired axis
    // Default: points +Y, tip at +Y
    // Three.js rotation: positive rotation.x rotates +Y toward +Z
    if (axis === 'x') {
      group.rotation.z = pointNegative ? Math.PI / 2 : -Math.PI / 2;
    } else if (axis === 'y') {
      if (pointNegative) {
        group.rotation.z = Math.PI; // Flip to point -Y
      }
    } else if (axis === 'z') {
      // rotation.x = PI/2 → +Y becomes +Z (arrow points up)
      // rotation.x = -PI/2 → +Y becomes -Z (arrow points down)
      group.rotation.x = pointNegative ? -Math.PI / 2 : Math.PI / 2;
    }

    return group;
  }

  private updateGizmoHover(event: MouseEvent): void {
    if (!this.rodGizmo || !this.selectedRodId) {
      if (this.hoveredAxis) {
        this.setArrowHighlight(this.hoveredAxis, false);
        this.hoveredAxis = null;
        this.renderer.domElement.style.cursor = this.rodPlacementMode ? 'crosshair' : 'default';
      }
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Collect all meshes from gizmo arrows
    const gizmoMeshes: THREE.Object3D[] = [];
    this.gizmoArrows.forEach((arrowGroup, axisName) => {
      arrowGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.userData.arrowType = axisName;
          gizmoMeshes.push(child);
        }
      });
    });

    const intersects = this.raycaster.intersectObjects(gizmoMeshes, false);

    if (intersects.length > 0) {
      const newHoveredAxis = intersects[0].object.userData.arrowType as string;
      if (newHoveredAxis !== this.hoveredAxis) {
        // Unhighlight old
        if (this.hoveredAxis) {
          this.setArrowHighlight(this.hoveredAxis, false);
        }
        // Highlight new
        this.hoveredAxis = newHoveredAxis;
        this.setArrowHighlight(this.hoveredAxis, true);
        this.renderer.domElement.style.cursor = 'grab';
      }
    } else {
      if (this.hoveredAxis) {
        this.setArrowHighlight(this.hoveredAxis, false);
        this.hoveredAxis = null;
        this.renderer.domElement.style.cursor = this.rodPlacementMode ? 'crosshair' : 'default';
      }
    }
  }

  private setArrowHighlight(axisName: string, highlighted: boolean): void {
    const arrowGroup = this.gizmoArrows.get(axisName);
    if (!arrowGroup) return;

    const baseColor = this.arrowBaseColors.get(axisName) || 0xffffff;

    arrowGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.MeshPhongMaterial;
        if (highlighted) {
          // Brighten the color for highlight
          material.color.setHex(0xffffff);
          material.emissive.setHex(baseColor);
          material.emissiveIntensity = 0.6;
        } else {
          material.color.setHex(baseColor);
          material.emissive.setHex(baseColor);
          material.emissiveIntensity = 0.2;
        }
      }
    });
  }

  private showRodGizmo(rodId: string): void {
    this.hideRodGizmo();

    const rodMesh = this.rodMeshes.get(rodId);
    if (!rodMesh || !this.boundingBox) return;

    const rod = this.getRodDataById(rodId);
    if (!rod) return;

    const modelHeight = this.boundingBox.max.z - this.boundingBox.min.z;
    const rodBottomZ = this.boundingBox.min.z + rod.bottomZ * modelHeight;
    const rodTopZ = this.boundingBox.min.z + rod.topZ * modelHeight;
    const rodCenterZ = (rodBottomZ + rodTopZ) / 2;
    const rodRadius = rod.diameter / 2;

    const arrowLength = this.modelScale * 0.2;

    this.rodGizmo = new THREE.Group();
    this.gizmoArrows.clear();
    this.arrowBaseColors.clear();

    // X arrow (red) - tip touches rod surface, arrow extends in +X
    const xColor = 0xff4444;
    const xArrow = this.createArrowGroup(xColor, arrowLength, 'x', false);
    // Arrow points +X, tip is at the +X end. Position so base is at rod surface.
    xArrow.position.set(rod.position.x + rodRadius, rod.position.y, rodCenterZ);
    xArrow.userData.arrowType = 'x';
    this.rodGizmo.add(xArrow);
    this.gizmoArrows.set('x', xArrow);
    this.arrowBaseColors.set('x', xColor);

    // Y arrow (green) - tip touches rod surface, arrow extends in +Y
    const yColor = 0x44ff44;
    const yArrow = this.createArrowGroup(yColor, arrowLength, 'y', false);
    yArrow.position.set(rod.position.x, rod.position.y + rodRadius, rodCenterZ);
    yArrow.userData.arrowType = 'y';
    this.rodGizmo.add(yArrow);
    this.gizmoArrows.set('y', yArrow);
    this.arrowBaseColors.set('y', yColor);

    // Top arrow (blue) - points DOWN toward rod top, tip touches rod top face
    // Arrow pointing -Z (down), tip at -Z end relative to group
    const topColor = 0x4488ff;
    const topArrowLength = arrowLength * 0.8;
    const topArrow = this.createArrowGroup(topColor, topArrowLength, 'z', true); // pointNegative=true for -Z
    // With pointNegative=true and axis='z', rotation.x = PI/2, so arrow points -Z
    // Tip is at group.position.z - topArrowLength
    // We want tip at rodTopZ, so: group.position.z - topArrowLength = rodTopZ
    // group.position.z = rodTopZ + topArrowLength
    topArrow.position.set(rod.position.x, rod.position.y, rodTopZ + topArrowLength);
    topArrow.userData.arrowType = 'top';
    this.rodGizmo.add(topArrow);
    this.gizmoArrows.set('top', topArrow);
    this.arrowBaseColors.set('top', topColor);

    // Bottom arrow (orange) - points UP toward rod bottom, tip touches rod bottom face
    const bottomColor = 0xff8844;
    const bottomArrowLength = arrowLength * 0.8;
    const bottomArrow = this.createArrowGroup(bottomColor, bottomArrowLength, 'z', false); // points +Z (up)
    // Arrow points +Z, tip at +Z end relative to group
    // Tip is at group.position.z + bottomArrowLength
    // We want tip at rodBottomZ, so: group.position.z + bottomArrowLength = rodBottomZ
    // group.position.z = rodBottomZ - bottomArrowLength
    bottomArrow.position.set(rod.position.x, rod.position.y, rodBottomZ - bottomArrowLength);
    bottomArrow.userData.arrowType = 'bottom';
    this.rodGizmo.add(bottomArrow);
    this.gizmoArrows.set('bottom', bottomArrow);
    this.arrowBaseColors.set('bottom', bottomColor);

    this.scene.add(this.rodGizmo);
  }

  private hideRodGizmo(): void {
    if (this.rodGizmo) {
      this.rodGizmo.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      this.scene.remove(this.rodGizmo);
      this.rodGizmo = null;
    }
    this.gizmoArrows.clear();
    this.arrowBaseColors.clear();
    this.hoveredAxis = null;
    this.draggingAxis = null;
  }

  private showSelectedRodIntersection(rodId: string, reducedDetail: boolean = false): void {
    // Throttle updates during dragging
    const now = performance.now();
    if (this.isDraggingRod) {
      if (now - this.lastIntersectionUpdateTime < this.INTERSECTION_THROTTLE_MS) {
        // Schedule an update if one isn't pending
        if (!this.pendingIntersectionUpdate) {
          this.pendingIntersectionUpdate = true;
          setTimeout(() => {
            this.pendingIntersectionUpdate = false;
            if (this.isDraggingRod && this.selectedRodId) {
              this.showSelectedRodIntersection(this.selectedRodId, true);
            }
          }, this.INTERSECTION_THROTTLE_MS);
        }
        return;
      }
    }
    this.lastIntersectionUpdateTime = now;

    // Use reduced detail during dragging for better performance
    const useReducedDetail = reducedDetail || this.isDraggingRod;

    this.hideSelectedRodIntersection();

    if (!this.boundingBox || !this.modelMesh) return;

    const rod = this.getRodDataById(rodId);
    if (!rod) return;

    this.selectedRodIntersectionGroup = new THREE.Group();

    // Reset the geometry pool for reuse
    this.intersectionGeometryPool.reset();

    this.buildRodIntersection(
      {
        x: rod.position.x,
        y: rod.position.y,
        diameter: rod.diameter,
        bottomZ: rod.bottomZ,
        topZ: rod.topZ,
      },
      this.intersectionGeometryPool,
      this.selectedRodIntersectionGroup,
      useReducedDetail
    );

    this.intersectionGeometryPool.hideUnused();
    this.scene.add(this.selectedRodIntersectionGroup);
    this.applyModelTransparency();
  }

  /**
   * Fills `group` with the green/red rings showing where a rod runs inside the
   * model and where it breaks out of it. Takes a bare probe rather than a rod
   * id so the same visualisation can run for a placed rod and for the ghost
   * rod following the cursor, and takes its pool from the caller so the two
   * can be on screen at once without fighting over pooled meshes.
   */
  private buildRodIntersection(
    probe: RodProbe,
    pool: IntersectionGeometryPool,
    group: THREE.Group,
    useReducedDetail: boolean
  ): void {
    if (!this.boundingBox || !this.modelMesh) return;

    const modelHeight = this.boundingBox.max.z - this.boundingBox.min.z;
    const rodBottomZ = this.boundingBox.min.z + probe.bottomZ * modelHeight;
    let rodTopZ = this.boundingBox.min.z + probe.topZ * modelHeight;
    const rodRadius = probe.diameter / 2;

    // In slice view, limit the visualization to below the slice plane
    if (this.viewMode === 'slices' && this.currentSlicePlaneZ !== null) {
      if (rodBottomZ > this.currentSlicePlaneZ) {
        // Entire rod is above the plane - no visualization needed
        return;
      }
      rodTopZ = Math.min(rodTopZ, this.currentSlicePlaneZ);
    }

    // Adaptive detail: fewer samples during drag
    const numSamples = useReducedDetail ? 8 : 16;
    const sampleRadius = rodRadius * 0.9; // Sample slightly inside the rod edge

    // For each sample point, collect intersection Z values
    // Structure: array of {angle, intersectionZs[]}
    const perimeterData: Array<{angle: number, x: number, y: number, intersections: number[]}> = [];

    // Reuse raycaster to avoid allocations
    const rayDirection = new THREE.Vector3(0, 0, -1);

    for (let i = 0; i < numSamples; i++) {
      const angle = (i / numSamples) * Math.PI * 2;
      const sampleX = probe.x + Math.cos(angle) * sampleRadius;
      const sampleY = probe.y + Math.sin(angle) * sampleRadius;

      this.raycaster.set(
        new THREE.Vector3(sampleX, sampleY, this.boundingBox.max.z + 10),
        rayDirection
      );
      const intersects = this.raycaster.intersectObject(this.modelMesh!);

      const zValues = intersects.map(i => i.point.z).sort((a, b) => b - a);
      perimeterData.push({ angle, x: sampleX, y: sampleY, intersections: zValues });
    }

    // Also sample the center
    this.raycaster.set(
      new THREE.Vector3(probe.x, probe.y, this.boundingBox.max.z + 10),
      rayDirection
    );
    const centerIntersects = this.raycaster.intersectObject(this.modelMesh);
    const centerZs = centerIntersects.map(i => i.point.z).sort((a, b) => b - a);

    // Collect all unique Z heights where any ray intersects (skip during drag for speed)
    const allZHeights = new Set<number>();
    if (!useReducedDetail) {
      for (const data of perimeterData) {
        for (const z of data.intersections) {
          allZHeights.add(Math.round(z * 100) / 100); // Round to avoid floating point issues
        }
      }
      for (const z of centerZs) {
        allZHeights.add(Math.round(z * 100) / 100);
      }
    }

    // Sample at regular Z intervals to show inside/outside status
    // Adaptive: coarser Z steps during drag
    const zStepDivisor = useReducedDetail ? 25 : 50;
    const zStep = Math.max(useReducedDetail ? 1.0 : 0.5, modelHeight / zStepDivisor);

    for (let z = rodBottomZ; z <= rodTopZ; z += zStep) {
      // For each sample point, determine if it's inside the model at this Z
      const insideFlags: boolean[] = [];

      for (const data of perimeterData) {
        const isInside = this.isPointInsideAtZ(data.intersections, z);
        insideFlags.push(isInside);
      }

      const centerInside = this.isPointInsideAtZ(centerZs, z);

      // Count how many perimeter points are inside
      const insideCount = insideFlags.filter(f => f).length;

      if (insideCount === 0 && !centerInside) {
        // Entirely outside - no visualization needed at this Z
        continue;
      }

      if (insideCount === numSamples && centerInside) {
        // Entirely inside - draw full green ring using pool
        const ring = pool.getFullRing(rodRadius * 0.95, rodRadius * 1.15);
        ring.position.set(probe.x, probe.y, z);
        group.add(ring);
      } else {
        // Partially inside - draw arcs for inside portions (green) and outside portions (red)
        this.drawPartialRingPooled(
          probe.x, probe.y, z,
          rodRadius, insideFlags, numSamples,
          pool, group
        );
      }
    }

    // Draw markers at actual surface intersection points (skip during drag)
    if (!useReducedDetail) {
      for (const zRounded of allZHeights) {
        const z = zRounded;
        if (z < rodBottomZ || z > rodTopZ) continue;

        // Determine which parts of the circumference cross the surface at this Z
        // Draw small spheres at the intersection points on the perimeter
        for (const data of perimeterData) {
          // Check if this Z is close to an intersection
          for (const intZ of data.intersections) {
            if (Math.abs(intZ - z) < 0.1) {
              const sphere = pool.getSphere(rodRadius * 0.2);
              sphere.position.set(data.x, data.y, intZ);
              group.add(sphere);
              break;
            }
          }
        }
      }
    }
  }

  /**
   * Check if a point is inside the model at a given Z height.
   * Uses intersection counts: odd = inside, even = outside.
   */
  private isPointInsideAtZ(intersectionZs: number[], z: number): boolean {
    // Count how many intersections are above this Z
    let count = 0;
    for (const intZ of intersectionZs) {
      if (intZ > z) count++;
    }
    // Odd count = inside, even count = outside
    return count % 2 === 1;
  }

  /**
   * Draw a ring with partial arcs using the geometry pool.
   */
  private drawPartialRingPooled(
    cx: number, cy: number, z: number,
    radius: number, insideFlags: boolean[], numSamples: number,
    pool: IntersectionGeometryPool, group: THREE.Group
  ): void {
    const innerRadius = radius * 0.95;
    const outerRadius = radius * 1.15;

    // Find contiguous segments of inside/outside
    let i = 0;
    while (i < numSamples) {
      const startInside = insideFlags[i];
      const startAngle = (i / numSamples) * Math.PI * 2;

      // Find end of this segment
      let j = i + 1;
      while (j < numSamples && insideFlags[j] === startInside) {
        j++;
      }

      const endAngle = (j / numSamples) * Math.PI * 2;
      const arcAngle = endAngle - startAngle;

      if (arcAngle > 0.01) {
        // Get arc from pool
        const arc = pool.getArc(
          innerRadius, outerRadius, startAngle, arcAngle, startInside
        );
        arc.position.set(cx, cy, z);
        group.add(arc);
      }

      i = j;
    }
  }

  private hideSelectedRodIntersection(): void {
    if (this.selectedRodIntersectionGroup) {
      // Just remove from scene - pooled geometries are managed by the pool
      // Non-pooled geometries (if any) will be cleaned up when pool is disposed
      this.scene.remove(this.selectedRodIntersectionGroup);
      this.selectedRodIntersectionGroup = null;
    }

    this.applyModelTransparency();
  }

  /**
   * The model fades back so the rings inside it can be read. Both the selected
   * rod and the placement preview can ask for this, so the opacity is derived
   * from whether either is on screen - otherwise whichever one is dismissed
   * first would snap the model back to solid under the other.
   */
  private applyModelTransparency(): void {
    if (!this.modelMesh) return;

    const showingIntersections =
      this.selectedRodIntersectionGroup !== null || this.placementIntersectionGroup !== null;
    (this.modelMesh.material as THREE.MeshPhongMaterial).opacity =
      showingIntersections ? 0.4 : 0.85;
  }

  /**
   * Rings for the rod being placed, drawn before it is committed: the same
   * inside/outside readout the selected rod gets, so a spot can be judged
   * while the cursor is still moving rather than after the fact.
   */
  private showPlacementIntersection(probes: Array<{ x: number; y: number }>): void {
    if (this.placementIntersectionGroup) {
      this.scene.remove(this.placementIntersectionGroup);
    }

    if (!this.liveIntersections || !this.boundingBox || !this.modelMesh || probes.length === 0) {
      this.hidePlacementIntersection();
      return;
    }

    this.placementIntersectionGroup = new THREE.Group();
    this.placementIntersectionPool.reset();

    for (const probe of probes) {
      // Reduced detail throughout: this runs on mouse move, and a placement
      // preview only has to answer "does the rod stay inside here?".
      this.buildRodIntersection(
        { x: probe.x, y: probe.y, diameter: this.previewRodDiameter, bottomZ: 0, topZ: 1 },
        this.placementIntersectionPool,
        this.placementIntersectionGroup,
        true
      );
    }

    this.placementIntersectionPool.hideUnused();
    this.scene.add(this.placementIntersectionGroup);
    this.applyModelTransparency();
  }

  private hidePlacementIntersection(): void {
    if (this.placementIntersectionGroup) {
      this.scene.remove(this.placementIntersectionGroup);
      this.placementIntersectionGroup = null;
    }

    this.placementIntersectionPool.reset();
    this.placementIntersectionPool.hideUnused();
    this.applyModelTransparency();
  }

  private updateSelectedRodIntersectionPositions(): void {
    // During dragging, recreate the intersection visualization with reduced detail
    // This ensures the tube and rings update with the rod position
    if (this.selectedRodId) {
      this.showSelectedRodIntersection(this.selectedRodId, this.isDraggingRod);
    }
  }

  private getRodDataById(rodId: string): AlignmentRod | null {
    // This will be set from updateAlignmentRods
    const mesh = this.rodMeshes.get(rodId);
    if (!mesh) return null;
    return mesh.userData.rodData as AlignmentRod || null;
  }

  updateGizmoPosition(): void {
    if (!this.rodGizmo || !this.selectedRodId || !this.boundingBox) return;

    const rod = this.getRodDataById(this.selectedRodId);
    if (!rod) return;

    // Just recreate the gizmo at new position
    this.showRodGizmo(this.selectedRodId);
  }

  private onResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.css2DRenderer.setSize(width, height);
  }

  /**
   * Eases yaw/pitch/distance/target toward their goals so orbiting feels
   * weighted instead of snapping, then rebuilds the camera transform.
   */
  private updateOrbitCamera(delta: number): void {
    // Frame-rate independent exponential smoothing
    const t = 1 - Math.exp(-this.ORBIT_DAMPING * delta);

    // Take the short way around the circle
    let yawDelta = this.targetYaw - this.yaw;
    yawDelta = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));

    this.yaw += yawDelta * t;
    this.pitch += (this.targetPitch - this.pitch) * t;
    this.distance += (this.targetDistance - this.distance) * t;
    this.target.lerp(this.desiredTarget, t);

    this.updateCameraRotation();
    this.updateOrbitPosition();
  }

  private animate(): void {
    requestAnimationFrame(this.animate.bind(this));

    const time = performance.now();
    const delta = (time - this.prevTime) / 1000;

    if (this.navMode === 'orbit') {
      this.updateOrbitCamera(delta);
      this.prevTime = time;
      this.renderer.render(this.scene, this.camera);
      this.css2DRenderer.render(this.scene, this.camera);
      return;
    }

    // Apply FPS movement with less damping for snappier control
    this.velocity.x -= this.velocity.x * 8.0 * delta;
    this.velocity.y -= this.velocity.y * 8.0 * delta;
    this.velocity.z -= this.velocity.z * 8.0 * delta;

    this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
    this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
    this.direction.y = Number(this.moveUp) - Number(this.moveDown);
    this.direction.normalize();

    // Apply acceleration
    const accel = this.moveSpeed * 3; // Faster acceleration
    if (this.moveForward || this.moveBackward) {
      this.velocity.z -= this.direction.z * accel * delta;
    }
    if (this.moveLeft || this.moveRight) {
      this.velocity.x -= this.direction.x * accel * delta;
    }
    if (this.moveUp || this.moveDown) {
      this.velocity.y -= this.direction.y * accel * delta;
    }

    // Move camera - Z is up
    // Forward direction on horizontal plane (project camera forward onto XY plane)
    const cameraForward = new THREE.Vector3(0, 0, -1);
    cameraForward.applyQuaternion(this.camera.quaternion);
    const forward = new THREE.Vector3(cameraForward.x, cameraForward.y, 0).normalize();

    // Right direction on horizontal plane
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 0, 1)).normalize();

    // Up is world Z
    const up = new THREE.Vector3(0, 0, 1);

    this.camera.position.addScaledVector(forward, -this.velocity.z * delta);
    this.camera.position.addScaledVector(right, -this.velocity.x * delta);
    this.camera.position.addScaledVector(up, -this.velocity.y * delta);

    this.prevTime = time;

    this.renderer.render(this.scene, this.camera);
    this.css2DRenderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize.bind(this));
    this.hideRodGizmo();
    this.hideSelectedRodIntersection();
    this.hidePreviewRod();
    this.intersectionGeometryPool.dispose();
    this.placementIntersectionPool.dispose();

    // Dispose rod labels
    for (const label of this.rodLabels.values()) {
      this.scene.remove(label);
      label.element.remove();
    }
    this.rodLabels.clear();

    // Dispose BVH when disposing viewer
    if (this.modelMesh) {
      bvhManager.disposeBVH(this.modelMesh.geometry);
    }

    this.renderer.dispose();
  }
}
