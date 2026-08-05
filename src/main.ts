import { App } from './App';

// Initialize fonts for browser environment (Vite-specific imports)
import './packing/viteFontLoader';

// Initialize the application when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();

  // Make app available globally for debugging
  (window as unknown as { app: App }).app = app;
});
