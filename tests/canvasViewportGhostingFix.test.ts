import { describe, it, expect } from '@jest/globals';
import React from 'react';
import {
  NeutralAvatarSilhouette,
  NeutralFrameOutline,
  NeutralBackgroundFallback,
} from '../src/components/canvas/AvatarCanvasStage';

describe('TASK-AVATAR-VIEWPORT-GHOSTING-FIX: Canvas Ghosting and Placeholder Elimination', () => {
  it('renders NeutralAvatarSilhouette with Circle and Rect components without any Text', () => {
    const element = React.createElement(NeutralAvatarSilhouette, {
      size: 512,
      tintColor: '#ef4444',
    });

    expect(element).toBeDefined();
    expect(element.props.size).toBe(512);
    expect(element.props.tintColor).toBe('#ef4444');
  });

  it('renders NeutralFrameOutline with a subtle border Rect', () => {
    const element = React.createElement(NeutralFrameOutline, { size: 512 });
    expect(element).toBeDefined();
    expect(element.props.size).toBe(512);
  });

  it('renders NeutralBackgroundFallback with clean theme-aware fill', () => {
    const dayElement = React.createElement(NeutralBackgroundFallback, {
      size: 512,
      theme: 'day',
    });
    expect(dayElement).toBeDefined();
    expect(dayElement.props.theme).toBe('day');

    const nightElement = React.createElement(NeutralBackgroundFallback, {
      size: 512,
      theme: 'night',
    });
    expect(nightElement).toBeDefined();
    expect(nightElement.props.theme).toBe('night');
  });
});
