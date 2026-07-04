import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/** Persisted light/dark theme; applies `.dark` on <html>. Defaults to dark. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('pantau_theme') as Theme) || 'dark'
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('pantau_theme', theme);
  }, [theme]);

  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}
