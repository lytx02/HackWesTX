// Single source of truth for styling. Swap a preset or override any token
// here and every component updates (components only reference CSS variables
// like var(--color-primary), var(--font-body), var(--space-md)).
//
// Palette is the strict three-ink Chalk subset — deep purple linework, warm
// cream canvas, stark black silhouettes. Every other value below is a mix of
// those three, so nothing introduces a fourth hue. No gradients anywhere:
// tone is carried by flat fills, hairline rules, and hard-edged offsets.

const INK = '#4710C1'; // deep purple  — linework, structure, framing
const CREAM = '#F1E9D7'; // warm cream — canvas, parchment
const BLACK = '#1B191E'; // stark black — silhouettes, anchors

export const chalk = {
  name: 'chalk',
  font: {
    // Editorial serif for headlines, the poster hero voice.
    display: "'Playfair Display', 'Georgia', serif",
    // Warm academic serif that still reads at paragraph sizes.
    body: "'Spectral', 'Georgia', serif",
    // Geometric sans for labels, nav, buttons — the letterspaced caps.
    ui: "'Jost', 'Futura', 'Century Gothic', system-ui, sans-serif",
    mono: "'JetBrains Mono', 'Consolas', monospace",
    baseSize: '16px',
  },
  color: {
    bg: CREAM,
    surface: '#F7F1E2', // canvas, one shade lifted so panels read as paper
    surfaceAlt: '#E8E0CC', // recessed cream for wells and agent bubbles
    border: '#BEA8D0', // purple hairline at ~30% over cream
    borderStrong: INK,
    text: BLACK,
    textMuted: '#6E6878', // black lifted toward cream, faintly purple
    primary: INK,
    primaryText: CREAM,
    // Stark black is the anchor role: silhouettes, and the assistant, which
    // is the one "presence" in the interface.
    accent: BLACK,
    accentText: CREAM, // paired with accent; flips with it in the dark plate
    accentSoft: '#DCD5C4',
    success: INK,
    warning: BLACK,
    agent: BLACK,
    agentText: CREAM, // paired with agent; flips with it in the dark plate
    agentSoft: '#E2DBC9',
    ink: INK,
    cream: CREAM,
  },
  // Architectural, drafted — corners are cut, not rounded.
  radius: { sm: '2px', md: '4px', lg: '6px', pill: '999px' },
  space: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '40px' },
  // Letterpress offsets, not blurred glows. Flat by design.
  shadow: {
    soft: '2px 2px 0 rgba(27, 25, 30, 0.07)',
    lift: '4px 4px 0 rgba(71, 16, 193, 0.18)',
  },
  motion: {
    fast: '140ms cubic-bezier(.2, .7, .3, 1)',
    base: '280ms cubic-bezier(.2, .7, .3, 1)',
  },
  layout: { sidebar: '72px', maxWidth: '1200px' },
};

// The plate inverted: ink becomes the canvas, cream becomes the linework.
// Purple lifts toward cream so it stays legible on black.
const LIFTED = '#A78BFF';

export const chalkNight = {
  ...chalk,
  name: 'chalkNight',
  color: {
    ...chalk.color,
    bg: BLACK,
    surface: '#232128',
    surfaceAlt: '#2E2B36',
    border: '#443F55',
    borderStrong: LIFTED,
    text: CREAM,
    textMuted: '#9A9490',
    primary: LIFTED,
    primaryText: BLACK,
    accent: CREAM,
    accentText: BLACK,
    accentSoft: '#332F3D',
    success: LIFTED,
    warning: CREAM,
    agent: CREAM,
    agentText: BLACK,
    agentSoft: '#332F3D',
    ink: LIFTED,
  },
  shadow: {
    soft: '2px 2px 0 rgba(0, 0, 0, 0.30)',
    lift: '4px 4px 0 rgba(167, 139, 255, 0.30)',
  },
};

export const themes = { chalk, chalkNight };
export const defaultTheme = chalk;
