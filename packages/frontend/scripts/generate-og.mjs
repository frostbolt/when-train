import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="72%" cy="48%" r="58%">
      <stop offset="0%" stop-color="#1e1e28"/>
      <stop offset="100%" stop-color="#111111"/>
    </radialGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="8" stdDeviation="18" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="#111111"/>
  <rect width="1200" height="630" fill="url(#glow)" opacity="0.75"/>

  <!-- Wordmark -->
  <text x="80" y="278"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="90" font-weight="800" letter-spacing="-2"
    fill="#f5f5f5">whenTrain?</text>

  <!-- Tagline -->
  <text x="82" y="344"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="26" font-weight="400"
    fill="#6e6e73">NYC subway arrivals. No search.</text>
  <text x="82" y="381"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="26" font-weight="400"
    fill="#6e6e73">Just your nearest trains.</text>

  <!-- Route circles — A (blue), N (yellow), F (orange) -->
  <circle cx="838" cy="222" r="72" fill="#0039A6" filter="url(#shadow)"/>
  <text x="838" y="222"
    text-anchor="middle" dominant-baseline="central"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="64" font-weight="800" fill="#ffffff">A</text>

  <circle cx="1058" cy="310" r="72" fill="#FCCC0A" filter="url(#shadow)"/>
  <text x="1058" y="310"
    text-anchor="middle" dominant-baseline="central"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="64" font-weight="800" fill="#000000">N</text>

  <circle cx="892" cy="418" r="72" fill="#FF6319" filter="url(#shadow)"/>
  <text x="892" y="418"
    text-anchor="middle" dominant-baseline="central"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    font-size="64" font-weight="800" fill="#ffffff">F</text>
</svg>`;

const outputPath = join(__dirname, '..', 'public', 'og-image.png');

await sharp(Buffer.from(svg))
  .png()
  .toFile(outputPath);

console.log(`✓ og-image.png → ${outputPath}`);
