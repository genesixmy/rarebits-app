import React, { createContext, useState, useEffect, useContext } from 'react';

const initialState = {
  theme: 'light',
  setTheme: () => null,
};

export const ThemeProviderContext = createContext(initialState);

export function ThemeProvider({ children, defaultTheme = 'light', storageKey = 'rarebits-theme' }) {
  // DISABLED: Dark mode is disabled. Always use light theme.
  const [theme] = useState('light');

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add('light');
  }, []);

  const value = {
    theme: 'light',
    setTheme: () => null, // DISABLED: Theme switching is disabled
  };

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};