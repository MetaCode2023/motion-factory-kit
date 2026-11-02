// brand.js — your look, in one place. Every block in kit/blocks.js and the captions read from it.
// Edit the values, then every scene that loads this file picks them up.
//
// Fonts must be files in fonts/ (bundled: "Plus Jakarta Sans", "Barlow", "Barlow Condensed",
// "JetBrains Mono"). To use another font, add its woff2 files to fonts/ (see README).
window.BRAND = {
  name: 'Your Brand',
  handle: '@yourbrand',
  url: 'yourbrand.com',
  // A logo image, relative to the repo root (e.g. 'assets/logo.png'). null = show the name as text.
  logo: null,
  colors: {
    bg: '#0B0D12',        // background
    surface: '#161A22',   // cards
    line: '#2A303C',      // borders, tracks
    ink: '#F5F7FA',       // main text
    muted: '#8A93A6',     // secondary text
    accent: '#FC5C2B',    // the one highlight colour
    good: '#3DDC97',      // success, "after", checks
    bad: '#FF4D5E',       // errors, "before", crosses
  },
  fonts: {
    display: '"Plus Jakarta Sans"',
    body: '"Plus Jakarta Sans"',
    mono: '"JetBrains Mono"',
  },
};
