import { initializeFonts } from './SingleStrokeFont';

// Import digit SVG files at build time (Vite-specific)
import digit0Svg from './fonts/digits/digit-0.svg?raw';
import digit1Svg from './fonts/digits/digit-1.svg?raw';
import digit2Svg from './fonts/digits/digit-2.svg?raw';
import digit3Svg from './fonts/digits/digit-3.svg?raw';
import digit4Svg from './fonts/digits/digit-4.svg?raw';
import digit5Svg from './fonts/digits/digit-5.svg?raw';
import digit6Svg from './fonts/digits/digit-6.svg?raw';
import digit7Svg from './fonts/digits/digit-7.svg?raw';
import digit8Svg from './fonts/digits/digit-8.svg?raw';
import digit9Svg from './fonts/digits/digit-9.svg?raw';

const digitSvgs = [
  digit0Svg, digit1Svg, digit2Svg, digit3Svg, digit4Svg,
  digit5Svg, digit6Svg, digit7Svg, digit8Svg, digit9Svg,
];

// Initialize fonts immediately when this module is imported
initializeFonts(digitSvgs);

export { digitSvgs };
