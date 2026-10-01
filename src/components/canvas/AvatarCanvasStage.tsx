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
import { Stage, Layer, Image as KonvaImage, Rect, Text, Group } from 'react-konva';
import type Konva from 'konva';
import { RGB as RGBFilter } from 'konva/lib/filters/RGB';
import { useCanvasStore } from '../../store/canvasStore';
import { CritterAnchorLayer } from './CritterAnchorLayer';
import { clampNormalized } from '../../utils/coordinateMath';

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
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    const el = new window.Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => setImg(el);
    el.onerror = () => setImg(null);
    el.src = url;
    return () => {
      el.onload = null;
      el.onerror = null;
    };
  }, [url]);

  return img;
}

// ──────────────────────────────────────────────
// Placeholder rect for missing assets
// ──────────────────────────────────────────────

interface PlaceholderLayerProps {
  label: string;
  fill: string;
  opacity?: number;
  size: number;
}

const PlaceholderLayer: React.FC<PlaceholderLayerProps> = ({
  label,
  fill,
  opacity = 0.15,
  size,
}) => (
  <>
    <Rect width={size} height={size} fill={fill} opacity={opacity} />
    <Text
      text={label}
      x={0}
      y={size / 2 - 10}
      width={size}
      align="center"
      fill="rgba(255,255,255,0.3)"
      fontSize={Math.round(size * 0.022)}
    />
  </>
);

// ──────────────────────────────────────────────
// Full-size image layer (with optional RGBA tint)
// ──────────────────────────────────────────────

interface AssetImageLayerProps {
  assetUrl: string | undefined;
  placeholderLabel: string;
  placeholderFill: string;
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
  placeholderLabel,
  placeholderFill,
  size,
  tintColor,
  opacity = 1,
}) => {
  const img = useImage(assetUrl);
  const nodeRef = useRef<Konva.Image>(null);

  // Apply/remove RGBA tint filter whenever tintColor, image, or canvas size changes.
  // Re-creates node cache when tinted, or clears cache when untinted so resized images
  // never render stale cached bitmap bounds. (Fixes Devin BUG_0004.)
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
        // cache() is required for Konva filters to work.
        // Clear previous cache first so new dimensions are re-cached accurately.
        node.clearCache();
        node.cache();
      }
    } else {
      // Untinted images do not require caching; clear any cached raster buffer
      node.filters([]);
      node.clearCache();
    }
    node.getLayer()?.batchDraw();

    return () => {
      node?.clearCache();
    };
  }, [tintColor, img, size]);

  if (!img) {
    return (
      <PlaceholderLayer
        label={placeholderLabel}
        fill={placeholderFill}
        size={size}
      />
    );
  }

  return (
    <KonvaImage
      ref={nodeRef}
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

export const AvatarCanvasStage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

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
  }, []);

  // ── Asset URL resolution ───────────────────
  const bgItem = catalogIndex[backgroundId];
  const frameItem = catalogIndex[frameId];
  const silhouetteItem = avatarConfig.silhouetteId
    ? catalogIndex[avatarConfig.silhouetteId]
    : undefined;
  const clothingItem = avatarConfig.clothingId
    ? catalogIndex[avatarConfig.clothingId]
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

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center bg-slate-950"
      aria-label="Avatar canvas stage"
    >
      <Stage
        ref={stageRef}
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
        <Layer name="background">
          <AssetImageLayer
            assetUrl={bgItem?.assetUrl}
            placeholderLabel={`Background\n${state.backgroundTheme}`}
            placeholderFill="#0f172a"
            size={canvasSize}
          />
        </Layer>

        {/* ── Layer 2: Landscape / Isometric Terrain ── */}
        <Layer name="landscape">
          <AssetImageLayer
            assetUrl={landscapeItem?.assetUrl}
            placeholderLabel="Landscape"
            placeholderFill="#1e293b"
            size={canvasSize}
          />
        </Layer>

        {/* ── Layer 3: Avatar translated by anchor offset ── */}
        <Layer name="avatar">
          <Group x={anchorOffsetPx.x} y={anchorOffsetPx.y}>
            {/* Silhouette base — tinted via Konva RGBA filter */}
            <AssetImageLayer
              assetUrl={silhouetteItem?.assetUrl}
              placeholderLabel="Avatar Silhouette"
              placeholderFill="#334155"
              size={canvasSize}
              tintColor={avatarConfig.tintColor}
            />
            {/* Clothing overlay */}
            {clothingItem && (
              <AssetImageLayer
                assetUrl={clothingItem.assetUrl}
                placeholderLabel="Clothing"
                placeholderFill="#475569"
                size={canvasSize}
              />
            )}
            {/* Hand-rig overlay */}
            {handRigItem && (
              <AssetImageLayer
                assetUrl={handRigItem.assetUrl}
                placeholderLabel="Hand Rig"
                placeholderFill="#64748b"
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
        <Layer name="frame-hud">
          <AssetImageLayer
            assetUrl={frameItem?.assetUrl}
            placeholderLabel="Frame HUD"
            placeholderFill="#312e81"
            size={canvasSize}
            opacity={0.9}
          />
        </Layer>
      </Stage>
    </div>
  );
};
