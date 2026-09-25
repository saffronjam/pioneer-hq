import React, { createContext, useCallback, useContext, useState } from 'react';

interface DebugContextType {
  isDebugMode: boolean;
  enableDebugMode: () => void;
  disableDebugMode: () => void;
}

const DebugContext = createContext<DebugContextType | null>(null);

const DEBUG_MODE_KEY = 'pioneer-hq-debug-mode';

export function DebugProvider({ children }: { children: React.ReactNode }) {
  const [isDebugMode, setIsDebugMode] = useState(() => {
    return localStorage.getItem(DEBUG_MODE_KEY) === 'true';
  });

  const enableDebugMode = useCallback(() => {
    setIsDebugMode(true);
    localStorage.setItem(DEBUG_MODE_KEY, 'true');
  }, []);

  const disableDebugMode = useCallback(() => {
    setIsDebugMode(false);
    localStorage.removeItem(DEBUG_MODE_KEY);
  }, []);

  return (
    <DebugContext.Provider value={{ isDebugMode, enableDebugMode, disableDebugMode }}>
      {children}
    </DebugContext.Provider>
  );
}

export function useDebug() {
  const context = useContext(DebugContext);
  if (!context) {
    throw new Error('useDebug must be used within a DebugProvider');
  }
  return context;
}
