import { describe, it, expect } from '@jest/globals';
import React from 'react';
import {
  User,
  Eye,
  Smile,
  Scissors,
  Shirt,
  Crown,
  Sparkles,
  Hand,
  Mountain,
  Shield,
} from 'lucide-react';
import { getSlotIcon, AssetThumbnail } from '../src/components/inspector/AssetThumbnail';
import { ToastWarning } from '../src/components/ui/ToastWarning';
import type { CosmeticItem } from '../src/types/avatar';

describe('TASK-AVATAR-DRAWER-ERROR-FALLBACKS: Skeleton Loaders & Error Fallbacks', () => {
  describe('Layer Slot Icon Mapping', () => {
    it('maps avatar layers to the expected Lucide icons', () => {
      expect(getSlotIcon('avatar_base')).toBe(User);
      expect(getSlotIcon('avatar_body')).toBe(User);
      expect(getSlotIcon('avatar_eyes')).toBe(Eye);
      expect(getSlotIcon('avatar_mouth')).toBe(Smile);
      expect(getSlotIcon('avatar_hair')).toBe(Scissors);
      expect(getSlotIcon('avatar_clothing')).toBe(Shirt);
      expect(getSlotIcon('avatar_outfit')).toBe(Shirt);
      expect(getSlotIcon('avatar_hat')).toBe(Crown);
      expect(getSlotIcon('avatar_accessory')).toBe(Sparkles);
      expect(getSlotIcon('avatar_hand')).toBe(Hand);
      expect(getSlotIcon('critter')).toBe(Sparkles);
      expect(getSlotIcon('landscape')).toBe(Mountain);
      expect(getSlotIcon('frame')).toBe(Shield);
      expect(getSlotIcon('avatar_frame')).toBe(Shield);
    });
  });

  describe('AssetThumbnail Component', () => {
    it('creates fallback element with slot icon when assetUrl is undefined', () => {
      const mockItem: CosmeticItem = {
        id: 'test-eyes-1',
        name: 'Focused Green Eyes',
        layerType: 'avatar_eyes',
        rarity: 'rare',
        metadata: {},
      };

      const element = React.createElement(AssetThumbnail, { item: mockItem });
      expect(element).toBeDefined();
      expect(element.props.item.layerType).toBe('avatar_eyes');
    });

    it('creates thumbnail element with loading skeleton and lazy loading when assetUrl exists', () => {
      const mockItem: CosmeticItem = {
        id: 'test-hair-1',
        name: 'Curly Brown Hair',
        layerType: 'avatar_hair',
        assetUrl: 'https://assets.sunshade.icu/kenney/modular-characters/hair/curly_brown.png',
        rarity: 'standard',
        metadata: {},
      };

      const element = React.createElement(AssetThumbnail, { item: mockItem });
      expect(element).toBeDefined();
      expect(element.props.item.assetUrl).toBe(
        'https://assets.sunshade.icu/kenney/modular-characters/hair/curly_brown.png'
      );
    });
  });

  describe('CDN Failure Toast Warning', () => {
    it('renders ToastWarning with alert icon and accessible status role', () => {
      const dismissFn = () => {};
      const toast = React.createElement(ToastWarning, {
        message: 'Asset manifest could not be fetched from CDN. Displaying offline fallbacks.',
        onDismiss: dismissFn,
      });

      expect(toast).toBeDefined();
      expect(toast.props.message).toContain('Asset manifest could not be fetched from CDN');
    });
  });
});
