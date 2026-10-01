/**
 * @module components/inspector/useInspectorTabs
 *
 * Hook managing the active inspector category tab state.
 */

import { useState } from 'react';

export type InspectorTab = 'Frame' | 'Background' | 'Avatar' | 'Companion' | 'Landscape';

export const INSPECTOR_TABS: InspectorTab[] = [
  'Frame',
  'Background',
  'Avatar',
  'Companion',
  'Landscape',
];

export function useInspectorTabs() {
  const [activeTab, setActiveTab] = useState<InspectorTab>('Avatar');
  return { activeTab, setActiveTab };
}
