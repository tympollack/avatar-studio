/**
 * @module components/canvas/AvatarCanvasStage
 *
 * Primary interactive stage for the Avatar Studio customizer.
 *
 * Layer stack (back → front, strict z-order):
 *   1. Background   — day/night ambient environment image
 *   2. Landscape    — isometric terrain anchor / habitat
 *   3. Avatar       — silhouette → clothing → hand-rig composite
 *   4. Critter      — companion(s) at perch coordinates (CritterAnchorLayer)
 *   5. Frame HUD    — glassmorphic rarity border overlay
 *
 * Canvas is 1024×1024 virtual, auto-scaled to the smallest viewport dimension
 * while maintaining 1:1 aspect ratio. Supports pinch-zoom and pan for detail
 * inspection (headwear, hand rigs). Targets ≥60 FPS asset swaps via React-Konva.
 */

import type React from 'react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import { useCanvasStore } from '../../store/canvasStore';
import { CritterAnchorLayer } from './CritterAnchorLayer';

// ──────────────────────────────────────────────
// Virtual canvas constants
// ──────────────────────────────────────────────

const VIRTUAL_SIZE = 1024;

/** Minimum zoom level (1 = original, 0.5 = zoomed out 50%). */
const ZOOM_MIN = 0.5;
/** Maximum zoom level. */
const ZOOM_MAX = 5.0;
/** Zoom step per wheel tick. */
const ZOOM_STEP = 0.1;

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
// Full-size image layer
// ──────────────────────────────────────────────

interface AssetImageLayerProps {
  assetUrl: string | undefined;
  placeholderLabel: string;
  placeholderFill: string;
  size: number;
  /** Optional CSS filter tint applied via Konva cache (hex string). */
  tintColor?: string;
  opacity?: number;
}

const AssetImageLayer: React.FC<AssetImageLayerProps> = ({
  assetUrl,
  placeholderLabel,
  placeholderFill,
  size,
  opacity = 1,
}) => {
  const img = useImage(assetUrl);

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

  // Scale factor: maps virtual 1024px coords → actual canvas pixels.
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

    const newPos = {
      x: pointer.x - mousePointTo.x * newZoom,
      y: pointer.y - mousePointTo.y * newZoom,
    };

    setZoom(newZoom);
    setPanOffset(newPos);
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

        {/* ── Layer 3: Avatar (silhouette → clothing → hand-rig) ── */}
        <Layer name="avatar">
          {/* Silhouette base */}
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
