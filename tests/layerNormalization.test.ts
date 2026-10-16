import { normalizeLayerType } from '../src/types/avatar';

describe('normalizeLayerType', () => {
  it('normalizes base body layer variations', () => {
    expect(normalizeLayerType('base')).toBe('avatar_base');
    expect(normalizeLayerType('avatar_base')).toBe('avatar_base');
    expect(normalizeLayerType('avatar-base')).toBe('avatar_base');
    expect(normalizeLayerType('body')).toBe('avatar_body');
    expect(normalizeLayerType('avatar_body')).toBe('avatar_body');
  });

  it('normalizes facial feature variations', () => {
    expect(normalizeLayerType('hair')).toBe('avatar_hair');
    expect(normalizeLayerType('avatar_hair')).toBe('avatar_hair');
    expect(normalizeLayerType('eyes')).toBe('avatar_eyes');
    expect(normalizeLayerType('eye')).toBe('avatar_eyes');
    expect(normalizeLayerType('mouth')).toBe('avatar_mouth');
    expect(normalizeLayerType('avatar_mouth')).toBe('avatar_mouth');
  });

  it('normalizes garments, hats, and accessories', () => {
    expect(normalizeLayerType('clothing')).toBe('avatar_clothing');
    expect(normalizeLayerType('garment')).toBe('avatar_clothing');
    expect(normalizeLayerType('garments')).toBe('avatar_clothing');
    expect(normalizeLayerType('outfit')).toBe('avatar_outfit');
    expect(normalizeLayerType('outfits')).toBe('avatar_outfit');
    expect(normalizeLayerType('hat')).toBe('avatar_hat');
    expect(normalizeLayerType('hats')).toBe('avatar_hat');
    expect(normalizeLayerType('headwear')).toBe('avatar_hat');
    expect(normalizeLayerType('accessory')).toBe('avatar_accessory');
    expect(normalizeLayerType('accessories')).toBe('avatar_accessory');
    expect(normalizeLayerType('hand')).toBe('avatar_hand');
    expect(normalizeLayerType('hands')).toBe('avatar_hand');
    expect(normalizeLayerType('hand_rig')).toBe('avatar_hand');
  });

  it('normalizes frame, background, companions, and habitat landscape', () => {
    expect(normalizeLayerType('frame')).toBe('avatar_frame');
    expect(normalizeLayerType('frames')).toBe('avatar_frame');
    expect(normalizeLayerType('background')).toBe('background');
    expect(normalizeLayerType('backgrounds')).toBe('background');
    expect(normalizeLayerType('companion')).toBe('critter');
    expect(normalizeLayerType('companions')).toBe('critter');
    expect(normalizeLayerType('critter')).toBe('critter');
    expect(normalizeLayerType('critters')).toBe('critter');
    expect(normalizeLayerType('landscape')).toBe('landscape');
    expect(normalizeLayerType('landscapes')).toBe('landscape');
    expect(normalizeLayerType('plot')).toBe('landscape');
    expect(normalizeLayerType('terrain')).toBe('landscape');
  });

  it('gracefully handles null and undefined', () => {
    expect(normalizeLayerType(null)).toBe('avatar_base');
    expect(normalizeLayerType(undefined)).toBe('avatar_base');
    expect(normalizeLayerType('')).toBe('avatar_base');
  });
});
