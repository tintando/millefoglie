/**
 * Shared DOM helpers for keyboard/input handling.
 */

/**
 * True when the user is typing into a form control, so global keyboard
 * shortcuts should stand down and let the field handle the key.
 */
export function isInputFocused(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLInputElement ||
         active instanceof HTMLTextAreaElement ||
         active instanceof HTMLSelectElement;
}

/**
 * True while a modal overlay owns the screen. Components that listen for keys
 * on `document` use this to stand down, so e.g. F does not re-frame the model
 * behind an open help dialog. Modals mark themselves via `data-modal` on <html>.
 */
export function isModalOpen(): boolean {
  return document.documentElement.hasAttribute('data-modal');
}

export function setModalOpen(name: string, open: boolean): void {
  const root = document.documentElement;
  if (open) {
    root.setAttribute('data-modal', name);
  } else if (root.getAttribute('data-modal') === name) {
    root.removeAttribute('data-modal');
  }
}
