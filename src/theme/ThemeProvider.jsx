import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { themes, defaultTheme } from './tokens.js';

const ThemeContext = createContext(null);

// Flattens { color: { bg: '#fff' } } into [['--color-bg', '#fff'], ...]
function toCssVars(obj, prefix = '-') {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' ? toCssVars(v, `${prefix}-${k}`) : [[`${prefix}-${k}`, v]]
  );
}

export function ThemeProvider({ children, initial = defaultTheme.name }) {
  const [name, setName] = useState(initial);
  const theme = themes[name] ?? defaultTheme;

  useEffect(() => {
    const root = document.documentElement;
    toCssVars(theme).forEach(([k, v]) => root.style.setProperty(k, v));
    root.dataset.theme = theme.name;
  }, [theme]);

  const value = useMemo(
    () => ({ theme, name, setTheme: setName, available: Object.keys(themes) }),
    [theme, name]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
