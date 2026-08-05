import katex from "katex";
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { landmarkFormulaCandidates } from "./landmarkFormulaPreview";
import { analyzeLatexSource } from "./latexDiagnostics";
import "./LandmarkFormulaPicker.css";

export interface LandmarkFormulaPickerProps {
  markdown: string;
  value: number;
  onChange: (index: number) => void;
}

interface CompiledCandidate {
  html: string;
  fontSize: number;
}

function compileCandidate(markdown: string): CompiledCandidate {
  const range = analyzeLatexSource(markdown).ranges[0];
  const latex = range?.latex ?? "";
  const fontSize = Math.max(9, Math.min(13.5, 14 - Math.max(0, latex.length - 34) * .035));
  return {
    fontSize,
    html: katex.renderToString(latex || "\\phantom{x}", {
      displayMode: range?.display ?? false,
      throwOnError: false,
      strict: "ignore",
      trust: false,
      output: "htmlAndMathml",
    }),
  };
}

/**
 * A compact visual chooser for the equation shown inside a formula landmark.
 * The source never appears as an editing control: every choice is rendered by
 * KaTeX and identified to assistive technology by its document order only.
 */
export function LandmarkFormulaPicker({
  markdown,
  value,
  onChange,
}: LandmarkFormulaPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const candidates = useMemo(() => landmarkFormulaCandidates(markdown), [markdown]);
  const compiled = useMemo(
    () => candidates.map(compileCandidate),
    [candidates],
  );
  const selectedIndex = Number.isSafeInteger(value) && value >= 0 && value < candidates.length
    ? value
    : 0;

  useEffect(() => {
    const selected = pickerRef.current?.querySelector<HTMLElement>(
      `[data-formula-index="${selectedIndex}"]`,
    );
    if (typeof selected?.scrollIntoView === "function") {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // A chooser adds no information when the note has fewer than two usable
  // equations. Keeping it absent preserves the menu's quiet default state.
  if (compiled.length < 2) return null;

  const selectFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (index + 1) % compiled.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (index - 1 + compiled.length) % compiled.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = compiled.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    onChange(nextIndex);
    pickerRef.current
      ?.querySelector<HTMLButtonElement>(`[data-formula-index="${nextIndex}"]`)
      ?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={pickerRef}
      className="map-landmark-formula-picker"
      role="group"
      aria-label="Formula shown on landmark"
    >
      {compiled.map((candidate, index) => (
        <button
          key={`${index}:${candidates[index]}`}
          type="button"
          className="map-landmark-formula-picker__option"
          data-formula-index={index}
          aria-label={`Formula ${index + 1}`}
          aria-pressed={selectedIndex === index}
          title={`Formula ${index + 1}`}
          onClick={() => onChange(index)}
          onKeyDown={(event) => selectFromKeyboard(event, index)}
        >
          <span
            className="map-landmark-formula-picker__formula"
            aria-hidden="true"
            style={{ "--formula-picker-font-size": `${candidate.fontSize}px` } as CSSProperties}
            dangerouslySetInnerHTML={{ __html: candidate.html }}
          />
          <span className="map-landmark-formula-picker__ordinal" aria-hidden="true">
            {index + 1}
          </span>
        </button>
      ))}
    </div>
  );
}

export default LandmarkFormulaPicker;
