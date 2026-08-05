import { setModalOpen } from '../ui/domUtils';

interface Shortcut {
  keys: string[];
  action: string;
}

/**
 * Single source of truth for the shortcut list. The help table is generated
 * from this, so it cannot drift away from what the handlers actually bind.
 */
const SHORTCUTS: Shortcut[] = [
  { keys: ['?', 'H'], action: 'Open or close this help' },
  { keys: ['Esc'], action: 'Close help, or leave rod placement mode' },
  { keys: ['V'], action: 'Toggle between the model and the slice stack' },
  { keys: ['F'], action: 'Frame the model (zoom to fit)' },
  { keys: ['C'], action: 'Switch between orbit and fly navigation' },
  { keys: ['T'], action: 'Toggle light / dark theme' },
  { keys: ['1'], action: 'Front view' },
  { keys: ['2'], action: 'Right view' },
  { keys: ['3'], action: 'Top view' },
  { keys: ['4'], action: 'Isometric view' },
  { keys: ['↑', '→'], action: 'Next layer' },
  { keys: ['↓', '←'], action: 'Previous layer' },
  { keys: ['W', 'A', 'S', 'D'], action: 'Move the camera (fly mode)' },
  { keys: ['Space', 'Ctrl'], action: 'Move up / down (fly mode)' },
  { keys: ['I'], action: 'Nudge the selected rod along X (Shift reverses)' },
  { keys: ['J'], action: 'Nudge the selected rod along Y (Shift reverses)' },
  { keys: ['K'], action: 'Nudge the selected rod along Z (Shift reverses)' },
  { keys: ['Ctrl', 'S'], action: 'Save project' },
  { keys: ['Ctrl', 'O'], action: 'Open project' },
];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export class HelpOverlay {
  private overlay: HTMLElement;
  private card: HTMLElement;
  private closeBtn: HTMLButtonElement;
  private previouslyFocused: HTMLElement | null = null;

  constructor() {
    this.overlay = document.getElementById('help-overlay') as HTMLElement;
    this.card = this.overlay.querySelector('.help-card') as HTMLElement;
    this.closeBtn = document.getElementById('help-close-btn') as HTMLButtonElement;

    this.renderShortcuts();
    this.setupEventListeners();
  }

  private renderShortcuts(): void {
    const tbody = document.getElementById('help-shortcuts');
    if (!tbody) return;

    tbody.innerHTML = SHORTCUTS.map(({ keys, action }) => {
      const rendered = keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join(' ');
      return `<tr><td>${rendered}</td><td>${escapeHtml(action)}</td></tr>`;
    }).join('');
  }

  private setupEventListeners(): void {
    // Backdrop and the X both carry data-help-close
    this.overlay.querySelectorAll('[data-help-close]').forEach((el) => {
      el.addEventListener('click', () => this.close());
    });

    // Keep Tab inside the dialog while it is open
    this.overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;

      const focusable = Array.from(this.card.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || !this.card.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  open(): void {
    if (this.isOpen()) return;

    this.previouslyFocused = document.activeElement as HTMLElement | null;
    this.overlay.classList.remove('hidden');
    setModalOpen('help', true);
    this.closeBtn.focus();
  }

  close(): void {
    if (!this.isOpen()) return;

    this.overlay.classList.add('hidden');
    setModalOpen('help', false);

    // Hand focus back to whatever opened us
    if (this.previouslyFocused && document.contains(this.previouslyFocused)) {
      this.previouslyFocused.focus();
    }
    this.previouslyFocused = null;
  }

  toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
