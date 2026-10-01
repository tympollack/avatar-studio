/**
 * @module store/CanvasProvider
 *
 * Root context provider that wires canvasReducer into the component tree.
 * Wrap the editor layout with this to give canvas, inspector, and FAB
 * shared access to the active loadout state.
 */

import type React from 'react';
import { useReducer } from 'react';
import { CanvasContext, canvasReducer, defaultCanvasState } from './canvasStore';

interface CanvasProviderProps {
  children: React.ReactNode;
}

export const CanvasProvider: React.FC<CanvasProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(canvasReducer, defaultCanvasState);

  return (
    <CanvasContext.Provider value={{ state, dispatch }}>
      {children}
    </CanvasContext.Provider>
  );
};
