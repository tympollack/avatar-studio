/**
 * @module components/canvas/AvatarCanvasStage
 *
 * Primary interactive stage for the Avatar Studio customizer.
 *
 * Layer stack (back → front, strict z-order):
 *   1. Background   — day/night ambient environment image
 *   2. Landscape    — isometric terrain anchor / habitat
 *   3. Avatar       — silhouette → clothing → hand-rig composite (translated by anchor offset)
 *   4. Critter      — companion(s) at perch coordinates (CritterAnchorLayer)
 *   5. Frame HUD    — glassmorphic rarity border overlay
 *
 * Canvas is 1024×1024 virtual, auto-scaled to the smallest viewport dimension
 * while maintaining 1:1 aspect ratio. Supports pinch-zoom and pan for detail
 * inspection (headwear, hand rigs). Targets ≥60 FPS asset swaps via React-Konva.
 *
 * Anchor offset fix (Devin BUG_0004):
 *   The avatar layers and critter layer both receive the same anchor offset
 *   so companions remain locked to their perch sockets regardless of landscape.
 */

import type React from 'react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Circle, Group } from 'react-konva';
import type Konva from 'konva';
import { RGB as RGBFilter } from 'konva/lib/filters/RGB';
import { useCanvasStore } from '../../store/canvasStore';
import { CritterAnchorLayer } from './CritterAnchorLayer';
import { clampNormalized } from '../../utils/coordinateMath';
import { getCachedImage, loadImage } from '../../utils/imageLoader';

// ──────────────────────────────────────────────
// Virtual canvas constants
// ──────────────────────────────────────────────

const VIRTUAL_SIZE = 1024;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5.0;
const ZOOM_STEP = 0.1;

// ──────────────────────────────────────────────
// Hex colour → Konva RGBA filter values
// ──────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!result) return null;
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

// ──────────────────────────────────────────────
// Image preload hook
// ──────────────────────────────────────────────

function useImage(url: string | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(() => getCachedImage(url));

  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    const cached = getCachedImage(url);
    if (cached) {
      setImg(cached);
      return;
    }

    let active = true;
    loadImage(url)
      .then((loaded) => {
        if (active) setImg(loaded);
      })
      .catch(() => {
        if (active) setImg(null);
      });

    return () => {
      active = false;
    };
  }, [url]);

  return img;
}

// ──────────────────────────────────────────────
// Clean vector fallbacks (no overlapping text ghosting)
// ──────────────────────────────────────────────

export interface NeutralAvatarSilhouetteProps {
  size: number;
  tintColor?: string;
}

export const NeutralAvatarSilhouette: React.FC<NeutralAvatarSilhouetteProps> = ({
  size,
  tintColor,
}) => {
  const fillColor = tintColor || '#334155';
  const headRadius = size * 0.14;
  const centerX = size * 0.5;
  const headCenterY = size * 0.38;
  const torsoWidth = size * 0.38;
  const torsoHeight = size * 0.32;
  const torsoX = centerX - torsoWidth / 2;
  const torsoY = headCenterY + headRadius * 0.9;

  return (
    <Group name="fallback-silhouette" opacity={0.6}>
      <Circle x={centerX} y={headCenterY} radius={headRadius} fill={fillColor} />
      <Rect
        x={torsoX}
        y={torsoY}
        width={torsoWidth}
        height={torsoHeight}
        fill={fillColor}
        cornerRadius={[Math.round(size * 0.1), Math.round(size * 0.1), 0, 0]}
      />
    </Group>
  );
};

export interface NeutralFrameOutlineProps {
  size: number;
}

export const NeutralFrameOutline: React.FC<NeutralFrameOutlineProps> = ({ size }) => {
  const margin = Math.round(size * 0.03);
  const dimension = size - margin * 2;
  return (
    <Group name="fallback-frame-outline" opacity={0.5}>
      <Rect
        x={margin}
        y={margin}
        width={dimension}
        height={dimension}
        stroke="rgba(255,255,255,0.15)"
        strokeWidth={Math.max(1.5, Math.round(size * 0.003))}
        cornerRadius={Math.round(size * 0.03)}
      />
    </Group>
  );
};

export interface NeutralBackgroundFallbackProps {
  size: number;
  theme?: 'day' | 'night';
}

export const NeutralBackgroundFallback: React.FC<NeutralBackgroundFallbackProps> = ({
  size,
  theme = 'day',
}) => {
  const bgColor = theme === 'night' ? '#090d16' : '#0f172a';
  return <Rect width={size} height={size} fill={bgColor} />;
};

// ──────────────────────────────────────────────
// Full-size image layer (with optional RGBA tint and clean fallbacks)
// ──────────────────────────────────────────────

export type FallbackType = 'silhouette' | 'frame' | 'background' | 'landscape' | 'none';

interface AssetImageLayerProps {
  assetUrl: string | undefined;
  fallbackType?: FallbackType;
  theme?: 'day' | 'night';
  size: number;
  /**
   * Hex tint color (e.g. "#DC2626"). When provided, applies a Konva RGBA
   * colour-replacement filter to the image pixels. Requires cache() to be
   * called on the Konva node whenever the tint changes.
   */
  tintColor?: string;
  opacity?: number;
}

const AssetImageLayer: React.FC<AssetImageLayerProps> = ({
  assetUrl,
  fallbackType = 'none',
  theme = 'day',
  size,
  tintColor,
  opacity = 1,
}) => {
  const img = useImage(assetUrl);
  const nodeRef = useRef<Konva.Image>(null);

  // Apply/remove RGBA tint filter whenever tintColor, image, or canvas size changes.
  useEffect(() => {
    const node = nodeRef.current;
    if (!node || !img) return;

    if (tintColor) {
      const rgb = hexToRgb(tintColor);
      if (rgb) {
        node.red(rgb.r);
        node.green(rgb.g);
        node.blue(rgb.b);
        node.filters([RGBFilter]);
        node.clearCache();
        node.cache();
      }
    } else {
      node.filters([]);
      node.clearCache();
    }
    node.getLayer()?.batchDraw();

    return () => {
      node?.clearCache();
    };
  }, [tintColor, img, size]);

  if (!img) {
    if (fallbackType === 'silhouette') {
      return <NeutralAvatarSilhouette size={size} tintColor={tintColor} />;
    }
    if (fallbackType === 'frame') {
      return <NeutralFrameOutline size={size} />;
    }
    if (fallbackType === 'background') {
      return <NeutralBackgroundFallback size={size} theme={theme} />;
    }
    return null;
  }

  return (
    <KonvaImage
      ref={nodeRef}
      name={assetUrl ? `asset-image:${assetUrl}` : 'asset-image'}
      image={img}
      x={0}
      y={0}
      width={size}
      height={size}
      opacity={opacity}
    />
  );
};

// ──────────────────────────────────────────────
// Main Stage
// ──────────────────────────────────────────────

export interface AvatarCanvasStageProps {
  stageRef?: React.RefObject<Konva.Stage | null>;
}

export const AvatarCanvasStage: React.FC<AvatarCanvasStageProps> = ({
  stageRef: externalStageRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalStageRef = useRef<Konva.Stage | null>(null);
  const stageRef = externalStageRef ?? internalStageRef;

  const { state } = useCanvasStore();
  const { avatarConfig, catalogIndex, landscapeConfig, backgroundId, frameId } = state;

  // ── Responsive sizing ──────────────────────
  const [canvasSize, setCanvasSize] = useState(VIRTUAL_SIZE);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const side = Math.floor(Math.min(entry.contentRect.width, entry.contentRect.height));
      setCanvasSize(Math.max(side, 200));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = canvasSize / VIRTUAL_SIZE;

  // ── Zoom + Pan state ───────────────────────
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldZoom = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const direction = e.evt.deltaY < 0 ? 1 : -1;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldZoom + direction * ZOOM_STEP));
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldZoom,
      y: (pointer.y - stage.y()) / oldZoom,
    };
    setZoom(newZoom);
    setPanOffset({
      x: pointer.x - mousePointTo.x * newZoom,
      y: pointer.y - mousePointTo.y * newZoom,
    });
  }, [stageRef]);

  // ── Asset URL resolution ───────────────────
  const bgItem = catalogIndex[backgroundId];
  const frameItem = catalogIndex[frameId];
  const silhouetteItem = avatarConfig.silhouetteId
    ? catalogIndex[avatarConfig.silhouetteId]
    : undefined;
  const eyesItem = avatarConfig.eyesId
    ? catalogIndex[avatarConfig.eyesId]
    : undefined;
  const mouthItem = avatarConfig.mouthId
    ? catalogIndex[avatarConfig.mouthId]
    : undefined;
  const hairItem = avatarConfig.hairId
    ? catalogIndex[avatarConfig.hairId]
    : undefined;
  const clothingItem = avatarConfig.clothingId
    ? catalogIndex[avatarConfig.clothingId]
    : undefined;
  const hatItem = avatarConfig.hatId
    ? catalogIndex[avatarConfig.hatId]
    : undefined;
  const accessoryItem = avatarConfig.accessoryId
    ? catalogIndex[avatarConfig.accessoryId]
    : undefined;
  const handRigItem = avatarConfig.handRigId
    ? catalogIndex[avatarConfig.handRigId]
    : undefined;
  const landscapeItem = catalogIndex[landscapeConfig.landscapeId];

  /**
   * Avatar + critter anchor offset in pixels.
   * Translates the avatar group by the same delta used by CritterAnchorLayer
   * so companions stay locked to their perch sockets on any landscape anchor.
   * Clamps normalized coordinates to [0, 1] identically to CritterAnchorLayer (Fixes Devin BUG_0006).
   */
  const clampedAnchor = clampNormalized(landscapeConfig.anchorCoordinates);
  const anchorOffsetPx = {
    x: (clampedAnchor.x - 0.5) * canvasSize,
    y: (clampedAnchor.y - 0.75) * canvasSize,
  };

  // Requirement 1: Clear canvas stage and layers bounding context before repainting
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    for (const layer of stage.getLayers()) {
      const nativeCanvas = layer.getCanvas();
      const ctx = nativeCanvas?.getContext();
      if (ctx && '_context' in ctx) {
        (ctx as any)._context?.clearRect(0, 0, canvasSize, canvasSize);
      }
      layer.clear();
      layer.batchDraw();
    }
    stage.batchDraw();
  }, [
    canvasSize,
    backgroundId,
    state.backgroundTheme,
    landscapeConfig.landscapeId,
    avatarConfig,
    state.critters,
    frameId,
    stageRef,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center bg-slate-950"
      aria-label="Avatar canvas stage"
    >
      <Stage
        ref={stageRef as unknown as React.RefObject<Konva.Stage>}
        width={canvasSize}
        height={canvasSize}
        scaleX={zoom}
        scaleY={zoom}
        x={panOffset.x}
        y={panOffset.y}
        draggable
        onWheel={handleWheel}
      >
        {/* ── Layer 1: Background ── */}
        <Layer name="background" clearBeforeDraw={true}>
          <AssetImageLayer
            assetUrl={bgItem?.assetUrl}
            fallbackType="background"
            theme={state.backgroundTheme}
            size={canvasSize}
          />
        </Layer>

        {/* ── Layer 2: Landscape / Isometric Terrain ── */}
        <Layer name="landscape" clearBeforeDraw={true}>
          <AssetImageLayer
            assetUrl={landscapeItem?.assetUrl}
            fallbackType="landscape"
            size={canvasSize}
          />
        </Layer>

        {/* ── Layer 3: Ordered Modular Avatar (Kenney Character Specification) ── */}
        <Layer name="avatar" clearBeforeDraw={true}>
          <Group x={anchorOffsetPx.x} y={anchorOffsetPx.y}>
            {/* 1. Base Body silhouette — clean vector fallback, tinted via Konva RGBA filter */}
            <AssetImageLayer
              assetUrl={silhouetteItem?.assetUrl}
              fallbackType="silhouette"
              size={canvasSize}
              tintColor={avatarConfig.tintColor}
            />

            {/* 2. Eyes overlay */}
            {eyesItem && (
              <AssetImageLayer
                assetUrl={eyesItem.assetUrl}
                fallbackType="none"
                size={canvasSize}
              />
            )}

            {/* 3. Mouth overlay */}
            {mouthItem && (
              <AssetImageLayer
                assetUrl={mouthItem.assetUrl}
                fallbackType="none"
                size={canvasSize}
              />
            )}

            {/* 4. Hair overlay */}
            {hairItem && (
              <AssetImageLayer
                assetUrl={hairItem.assetUrl}
                fallbackType="none"
                size={canvasSize}
              />
            )}

            {/* 5. Garments / Outfit overlay */}
            {clothingItem && (
              <AssetImageLayer
                assetUrl={clothingItem.assetUrl}
                fallbackType="none"
                size={canvasSize}
              />
            )}

            {/* 6. Hat / Glasses / Accessories */}
            {hatItem && (
              <AssetImageLayer
                assetUrl={hatItem.assetUrl}
                fallbackType="none"
                size={canvasSize}
              />
            )}
            {accessoryItem && (
              <AssetImageLayer
                assetUrl={accessoryItem.assetUrl}
                fallbackType="none"
                size={canvasSize}
              />
            )}

            {/* Hand-rig overlay */}
            {handRigItem && (
              <AssetImageLayer
                assetUrl={handRigItem.assetUrl}
                fallbackType="none"
                size={canvasSize}
              />
            )}
          </Group>
        </Layer>

        {/* ── Layer 4: Critter companions (anchor-coordinated) ── */}
        <CritterAnchorLayer
          critters={state.critters}
          catalogIndex={catalogIndex}
          anchorOffset={landscapeConfig.anchorCoordinates}
          canvasSize={canvasSize}
          scale={scale}
        />

        {/* ── Layer 5: Glassmorphic Frame HUD overlay ── */}
        <Layer name="frame-hud" clearBeforeDraw={true}>
          <AssetImageLayer
            assetUrl={frameItem?.assetUrl}
            fallbackType="frame"
            size={canvasSize}
            opacity={0.9}
          />
        </Layer>
      </Stage>
    </div>
  );
};
