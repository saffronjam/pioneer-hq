import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useUpdateNodeInternals } from '@xyflow/react';

const NodeMeasurements = createContext<(id: string) => void>(() => {});

/** Coalesces handle geometry changes into one React Flow measurement pass. */
export function NodeMeasurementsProvider({ children }: { children: ReactNode }) {
  const updateInternals = useUpdateNodeInternals();
  const pending = useRef(new Set<string>());
  const queued = useRef(false);
  const schedule = useCallback(
    (id: string) => {
      pending.current.add(id);
      if (queued.current) return;
      queued.current = true;
      queueMicrotask(() => {
        queued.current = false;
        const ids = [...pending.current];
        pending.current.clear();
        if (ids.length) updateInternals(ids);
      });
    },
    [updateInternals]
  );
  useEffect(() => {
    const ids = pending.current;
    return () => ids.clear();
  }, []);
  return <NodeMeasurements.Provider value={schedule}>{children}</NodeMeasurements.Provider>;
}

/** Initial size is observed by React Flow; explicit updates track later handle changes. */
export function useNodeMeasurement(id: string, geometry: string) {
  const schedule = useContext(NodeMeasurements);
  const previous = useRef({ id, geometry });
  useEffect(() => {
    if (previous.current.id === id && previous.current.geometry !== geometry) schedule(id);
    previous.current = { id, geometry };
  }, [id, geometry, schedule]);
}
