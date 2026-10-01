/**
 * @module components/canvas/CritterAnchorLayer
 *
 * Renders all attached critter companions at their correct perch socket
 * positions within the Konva stage.
 *
 * Features:
 *   - Normalised coordinate resolution via coordinateMath utilities.
 *   - Idle bob animation: sinusoidal Y oscillation driven by requestAnimationFrame
 *     (hover-perch critters bob 8px; others bob 3px for a subtle breathing effect).
 *   - Scale-stable — positions clamp to canvas bounds on resize.
 *   - Renders an empty <Layer> when no critters are equipped (zero fake data).
 */

import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Layer, Image as KonvaImage, Group } from 'react-konva';
import type { CritterConfig, CosmeticItem } from '../../types/avatar';
import type { NormalizedCoord } from '../../utils/coordinateMath';
import { resolvePerchPixel, clampNormalized, VIRTUAL_CANVAS_SIZE } from '../../utils/coordinateMath';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

/** Critter render size as a fraction of the virtual canvas. */
const CRITTER_SIZE_FRAC = 0.12; // 12% of canvas = 123px on a 1024 virtual canvas

/** Bob amplitude in virtual pixels per perch type. */
const BOB_AMP: Record<string, number> = {
  hover: 8,
  shoulder: 3,
  pocket: 3,
  ground: 2,
};
const BOB_FREQ = 0.0015; // radians per millisecond

// ──────────────────────────────────────────────
// Image hook
// ──────────────────────────────────────────────

function useCritterImage(url: string | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) { setImg(null); return; }
    const el = new window.Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => setImg(el);
    el.onerror = () => setImg(null);
    el.src = url;
    return () => { el.onload = null; el.onerror = null; };
  }, [url]);
  return img;
}

// ──────────────────────────────────────────────
// Single animated critter node
// ──────────────────────────────────────────────

interface AnimatedCritterProps {
  critter: CritterConfig;
  catalogIndex: Record<string, CosmeticItem>;
  anchorOffset: NormalizedCoord;
  canvasSize: number;
  scale: number;
  perchCollisionOffset?: number;
}

const AnimatedCritter: React.FC<AnimatedCritterProps> = ({
  critter,
  catalogIndex,
  anchorOffset,
  canvasSize,
  scale,
  perchCollisionOffset = 0,
}) => {
  const item = catalogIndex[critter.critterId];
  const img = useCritterImage(item?.assetUrl);
  const [bobY, setBobY] = useState(0);
  const rafRef = useRef<number>(0);

  // Idle bob animation
  useEffect(() => {
    let startTime: number | null = null;
    const amp = (BOB_AMP[critter.perchLocation] ?? 3) * scale;

    const tick = (ts: number) => {
      if (startTime === null) startTime = ts;
      const elapsed = ts - startTime;
      setBobY(Math.sin(elapsed * BOB_FREQ * Math.PI * 2) * amp);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [critter.perchLocation, scale]);

  const clamped = clampNormalized(anchorOffset);
  const pixel = resolvePerchPixel(critter.perchLocation, clamped, canvasSize);
  const critterSize = CRITTER_SIZE_FRAC * canvasSize;
  const collisionShiftX = perchCollisionOffset * (critterSize * 0.4);

  if (!img) {
    // Render nothing for unresolved assets — zero fake data / placeholders.
    return null;
  }

  return (
    <Group x={pixel.x - critterSize / 2 + collisionShiftX} y={pixel.y - critterSize / 2 + bobY}>
      <KonvaImage
        image={img}
        width={critterSize}
        height={critterSize}
      />
    </Group>
  );
};

// ──────────────────────────────────────────────
// Layer wrapper
// ──────────────────────────────────────────────

interface CritterAnchorLayerProps {
  critters: CritterConfig[];
  catalogIndex: Record<string, CosmeticItem>;
  anchorOffset: NormalizedCoord;
  canvasSize: number;
  scale: number;
}

export const CritterAnchorLayer: React.FC<CritterAnchorLayerProps> = ({
  critters,
  catalogIndex,
  anchorOffset,
  canvasSize,
  scale,
}) => {
  // Guard: empty layer when no critters equipped — no placeholders.
  if (critters.length === 0) {
    return <Layer name="critter-anchors" />;
  }

  return (
    <Layer name="critter-anchors">
      {critters.map((critter, idx) => {
        const samePerchPrior = critters
          .slice(0, idx)
          .filter((c) => c.perchLocation === critter.perchLocation).length;

        return (
          <AnimatedCritter
            key={`${critter.critterId}-${idx}`}
            critter={critter}
            catalogIndex={catalogIndex}
            anchorOffset={anchorOffset}
            canvasSize={canvasSize}
            scale={scale}
            perchCollisionOffset={samePerchPrior}
          />
        );
      })}
    </Layer>
  );
};

// Re-export for reference in other canvas modules.
export { VIRTUAL_CANVAS_SIZE };
