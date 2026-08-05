import { Check, Clipboard, ClipboardPaste, Palette, Pipette } from "lucide-react";
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { DEFAULT_COLOR_PALETTE } from "../domain/mapAppearance";

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Number.isFinite(value) ? Math.round(value) : 0));
}

function normalizeHex(value: string) {
  const candidate = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(candidate)) {
    return `#${candidate.split("").map((character) => character.repeat(2)).join("")}`.toUpperCase();
  }
  if (/^[0-9a-f]{6}$/i.test(candidate)) return `#${candidate}`.toUpperCase();
  return undefined;
}

function hexChannels(value: string) {
  const hex = normalizeHex(value) ?? "#000000";
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function channelsHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

export function ColorStudio({
  color,
  copiedColor,
  onChange,
  onCopy,
}: {
  color: string;
  copiedColor?: string;
  onChange: (color: string) => void;
  onCopy: () => void;
}) {
  const inputId = useId();
  const [draftHex, setDraftHex] = useState(() => normalizeHex(color) ?? color);
  const normalizedColor = normalizeHex(color) ?? "#000000";
  const channels = useMemo(() => hexChannels(normalizedColor), [normalizedColor]);
  const [draftChannels, setDraftChannels] = useState(() => ({
    red: String(channels.red),
    green: String(channels.green),
    blue: String(channels.blue),
  }));

  useEffect(() => {
    setDraftHex(normalizedColor);
    const next = hexChannels(normalizedColor);
    setDraftChannels({
      red: String(next.red),
      green: String(next.green),
      blue: String(next.blue),
    });
  }, [normalizedColor]);

  const commitHex = (candidate: string) => {
    const next = normalizeHex(candidate);
    if (next) {
      setDraftHex(next);
      onChange(next);
    } else {
      setDraftHex(normalizedColor);
    }
  };

  const commitChannel = (channel: "red" | "green" | "blue") => {
    const candidate = draftChannels[channel].trim();
    if (!/^\d{1,3}$/.test(candidate)) {
      setDraftChannels((current) => ({ ...current, [channel]: String(channels[channel]) }));
      return;
    }
    const value = clampChannel(Number(candidate));
    const next = { ...channels, [channel]: value };
    const hex = channelsHex(next.red, next.green, next.blue);
    setDraftHex(hex);
    setDraftChannels((current) => ({ ...current, [channel]: String(value) }));
    if (hex !== normalizedColor) onChange(hex);
  };

  return (
    <div className="map-color-studio">
      <div className="map-color-rainbow" aria-label="Colour palette">
        {DEFAULT_COLOR_PALETTE.map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            className="map-color-chip"
            style={{ "--swatch": swatch.color } as CSSProperties}
            aria-label={swatch.label}
            title={swatch.label}
            aria-pressed={normalizedColor === swatch.color.toUpperCase()}
            onClick={() => {
              setDraftHex(swatch.color.toUpperCase());
              onChange(swatch.color);
            }}
          >
            {normalizedColor === swatch.color.toUpperCase() && <Check size={12} aria-hidden="true" />}
          </button>
        ))}
        <label className="map-color-chip map-color-chip--custom" htmlFor={inputId} title="Pick any colour">
          <Palette size={15} aria-hidden="true" />
          <input
            id={inputId}
            type="color"
            value={normalizedColor}
            aria-label="Pick any RGB colour"
            onChange={(event) => {
              const next = event.currentTarget.value.toUpperCase();
              setDraftHex(next);
              onChange(next);
            }}
          />
        </label>
      </div>

      <div className="map-color-values">
        <label className="map-color-hex">
          <span>#</span>
          <input
            value={draftHex.replace(/^#/, "")}
            aria-label="Hex colour"
            maxLength={6}
            spellCheck={false}
            onChange={(event) => setDraftHex(`#${event.currentTarget.value}`)}
            onBlur={(event) => commitHex(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitHex(event.currentTarget.value);
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        {(["red", "green", "blue"] as const).map((channel) => (
          <label key={channel} className="map-color-channel">
            <span>{channel[0].toUpperCase()}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={255}
              value={draftChannels[channel]}
              aria-label={`${channel} channel`}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === "" || /^\d{0,3}$/.test(value)) {
                  setDraftChannels((current) => ({ ...current, [channel]: value }));
                }
              }}
              onBlur={() => commitChannel(channel)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitChannel(channel);
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  setDraftChannels((current) => ({ ...current, [channel]: String(channels[channel]) }));
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        ))}
      </div>

      <div className="map-color-transfer">
        <span className="map-color-preview" style={{ "--swatch": normalizedColor } as CSSProperties} aria-hidden="true" />
        <button type="button" aria-label="Copy colour" title="Copy colour" onClick={onCopy}>
          <Pipette size={14} aria-hidden="true" />
          <Clipboard size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Paste copied colour"
          title="Paste copied colour"
          disabled={!copiedColor}
          onClick={() => copiedColor && onChange(copiedColor)}
        >
          <ClipboardPaste size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
