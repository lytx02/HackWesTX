// Single source of truth for styling. Swap a preset or override any token
// here and every component updates (components only reference CSS variables
// like var(--color-primary), var(--font-body), var(--space-md)).

export const academic = {
  name: 'academic',
  font: {
    body: "'Source Serif 4', 'Georgia', serif",
    ui: "'Inter', 'Segoe UI', system-ui, sans-serif",
    mono: "'JetBrains Mono', 'Consolas', monospace",
    baseSize: '16px',
  },
  color: {
    bg: '#f6f3ec', // warm paper
    surface: '#fffdf8',
    surfaceAlt: '#efeae0',
    border: '#d9d2c3',
    text: '#22211d',
    textMuted: '#6b665b',
    primary: '#2f4f4f', // deep slate green
    primaryText: '#ffffff',
    accent: '#b5533c', // brick
    accentSoft: '#f3dcd4',
    success: '#3f7d4e',
    warning: '#b8861b',
    agent: '#4a5f9e', // helper agent tint
    agentSoft: '#e1e6f5',
  },
  radius: { sm: '6px', md: '12px', lg: '20px', pill: '999px' },
  space: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '40px' },
  shadow: {
    soft: '0 2px 10px rgba(30, 25, 10, 0.06)',
    lift: '0 8px 24px rgba(30, 25, 10, 0.10)',
  },
  motion: { fast: '120ms ease', base: '220ms ease' },
  layout: { sidebar: '72px', maxWidth: '1200px' },
};

// Alternate preset to prove the styling is modular (dark, sans-serif).
export const nocturne = {
  ...academic,
  name: 'nocturne',
  font: { ...academic.font, body: academic.font.ui },
  color: {
    ...academic.color,
    bg: '#15171c',
    surface: '#1e2128',
    surfaceAlt: '#262a33',
    border: '#343946',
    text: '#eceef2',
    textMuted: '#9aa0ad',
    primary: '#8fb3ff',
    primaryText: '#0d1220',
    accent: '#ff9f7a',
    accentSoft: '#3a2a24',
    agent: '#9fb0ff',
    agentSoft: '#272c40',
  },
};

export const themes = { academic, nocturne };
export const defaultTheme = academic;
