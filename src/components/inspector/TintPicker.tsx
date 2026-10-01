/**
 * @module components/inspector/TintPicker
 *
 * Hex color picker strip for tintable components (hair, aura emissions, garment accents).
 * Renders a row of quick-select preset swatches plus a native <input type="color">
 * for fully custom hex values.
 *
 * On selection the parent receives a validated '#RRGGBB' hex string.
 */

import type React from 'react';
import { clsx } from 'clsx';

const PRESET_TINTS = [
  { label: 'Crimson', value: '#DC2626' },
  { label: 'Amber', value: '#D97706' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Indigo', value: '#4F46E5' },
  { label: 'Violet', value: '#7C3AED' },
  { label: 'Rose', value: '#E11D48' },
  { label: 'Cyan', value: '#0891B2' },
  { label: 'White', value: '#F8FAFC' },
  { label: 'Midnight', value: '#0F172A' },
];

interface TintPickerProps {
  /** Current hex value (e.g. '#FF9900') or undefined if no tint applied. */
  value: string | undefined;
  onChange: (hex: string | undefined) => void;
  label?: string;
}

export const TintPicker: React.FC<TintPickerProps> = ({
  value,
  onChange,
  label = 'Tint Color',
}) => {
  const handlePreset = (hex: string) => {
    onChange(value === hex ? undefined : hex);
  };

  const handleCustom = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleClear = () => {
    onChange(undefined);
  };

  return (
    <div className="space-y-2 px-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </span>
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-slate-500 underline hover:text-slate-300"
          >
            Clear
          </button>
        )}
      </div>

      {/* Preset strip */}
      <div className="flex flex-wrap gap-1.5">
        {PRESET_TINTS.map((p) => (
          <button
            key={p.value}
            type="button"
            title={p.label}
            onClick={() => handlePreset(p.value)}
            aria-pressed={value === p.value}
            className={clsx(
              'h-7 w-7 rounded-full border-2 transition-transform',
              value === p.value
                ? 'scale-110 border-white shadow-md'
                : 'border-slate-700 hover:border-slate-400',
            )}
            style={{ backgroundColor: p.value }}
          />
        ))}

        {/* Custom color input */}
        <label
          title="Custom color"
          className={clsx(
            'relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border-2',
            'border-dashed border-slate-500 hover:border-slate-300',
          )}
        >
          <span
            className="block h-full w-full rounded-full"
            style={{ backgroundColor: value ?? 'transparent' }}
          />
          <input
            type="color"
            value={value ?? '#6366f1'}
            onChange={handleCustom}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Custom tint color"
          />
        </label>
      </div>

      {/* Current value display */}
      {value && (
        <p className="font-mono text-[10px] text-slate-500">
          {value.toUpperCase()}
        </p>
      )}
    </div>
  );
};
