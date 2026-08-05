/**
 * Resolves the active colour theme from an explicit user preference or the OS
 * setting, persists the preference, and stamps `data-theme` on <html> so the
 * CSS custom properties in index.html pick the right token set.
 *
 * The same resolution runs in a tiny inline <script> in <head> before first
 * paint; keep STORAGE_KEY and the fallback order in sync with it.
 */

export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'millefoglie.theme';

export class ThemeManager {
  private preference: ThemePref;
  private resolved: ResolvedTheme;
  private mediaQuery: MediaQueryList;
  private listeners: Array<(theme: ResolvedTheme) => void> = [];

  constructor() {
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.preference = this.readStoredPreference();
    this.resolved = this.resolve();
    this.stamp();

    // Follow the OS while the preference is 'system'
    this.mediaQuery.addEventListener('change', () => {
      if (this.preference === 'system') {
        this.applyResolved();
      }
    });
  }

  getPreference(): ThemePref {
    return this.preference;
  }

  getResolved(): ResolvedTheme {
    return this.resolved;
  }

  setPreference(preference: ThemePref): void {
    this.preference = preference;

    try {
      if (preference === 'system') {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, preference);
      }
    } catch {
      // Private browsing / storage disabled - preference just won't persist
    }

    this.applyResolved();
  }

  /** Flips to the opposite of whatever is showing, as an explicit override. */
  toggle(): void {
    this.setPreference(this.resolved === 'dark' ? 'light' : 'dark');
  }

  onChange(callback: (theme: ResolvedTheme) => void): void {
    this.listeners.push(callback);
  }

  private readStoredPreference(): ThemePref {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      // Storage unavailable - fall through to system
    }
    return 'system';
  }

  private resolve(): ResolvedTheme {
    if (this.preference === 'light' || this.preference === 'dark') {
      return this.preference;
    }
    return this.mediaQuery.matches ? 'dark' : 'light';
  }

  private stamp(): void {
    document.documentElement.setAttribute('data-theme', this.resolved);
  }

  /** Re-resolves and notifies listeners only when the result actually changed. */
  private applyResolved(): void {
    const next = this.resolve();
    if (next === this.resolved) return;

    this.resolved = next;
    this.stamp();
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}
