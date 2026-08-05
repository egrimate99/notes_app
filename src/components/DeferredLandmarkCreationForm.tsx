import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { defaultLandmarkShape } from "../domain/mapAppearance";
import type { EditableLandmarkKind, GroupLevel } from "../state/mapCustomizationStore";
import {
  INFORMAL_NOTE_KIND_OPTION,
  MATHEMATICAL_LANDMARK_KIND_OPTIONS,
  PaperNoteGlyph,
  ShapeGlyph,
} from "./MapToolControls";

interface LandmarkCreationFormProps {
  icon: ReactNode;
  kindLabel: string;
  /** Notes need portable filenames; canvas-only groups do not. */
  fileName?: boolean;
  onCreate: (title: string) => void | Promise<void>;
  onBack: () => void;
  onCancel: () => void;
}

interface CanvasCreationPaletteProps {
  groupOptions: ReadonlyArray<{
    value: GroupLevel;
    label: string;
    icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  }>;
  onCreateGroup: (level: GroupLevel) => void;
  onCreateLandmark: (kind: EditableLandmarkKind) => void;
  informalNotePending?: boolean;
  informalNoteError?: string;
}

/** Loaded with the naming form only when the canvas creation flow is opened. */
export function CanvasCreationPalette({
  groupOptions,
  onCreateGroup,
  onCreateLandmark,
  informalNotePending = false,
  informalNoteError,
}: CanvasCreationPaletteProps) {
  return (
    <div className="map-tool-panel map-create-menu">
      <section className="map-create-menu__section map-create-menu__section--structure" aria-label="Structure">
        <div className="map-create-menu__groups">
          {groupOptions.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" data-group-level={value} onClick={() => onCreateGroup(value)}>
              <Icon size={18} aria-hidden={true} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="map-create-menu__section map-create-menu__section--informal" aria-label="Informal notes">
        <button
          type="button"
          className="map-create-menu__note"
          data-landmark-kind={INFORMAL_NOTE_KIND_OPTION.value}
          aria-label="Create informal note"
          aria-busy={informalNotePending || undefined}
          disabled={informalNotePending}
          onClick={() => onCreateLandmark(INFORMAL_NOTE_KIND_OPTION.value)}
        >
          {informalNotePending
            ? <LoaderCircle className="is-spinning" size={16} aria-hidden="true" />
            : <PaperNoteGlyph />}
          <span>{INFORMAL_NOTE_KIND_OPTION.label}</span>
        </button>
        {informalNoteError && (
          <p className="map-create-menu__note-error" role="alert">{informalNoteError}</p>
        )}
      </section>
      <section className="map-create-menu__section map-create-menu__section--mathematics" aria-label="Mathematical objects">
        <div className="map-create-menu__math">
          {MATHEMATICAL_LANDMARK_KIND_OPTIONS.map(({ value, label }) => (
            <button key={value} type="button" data-landmark-kind={value} onClick={() => onCreateLandmark(value)}>
              <ShapeGlyph shape={defaultLandmarkShape(value)} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function normalizedTitle(value: string, fileName: boolean) {
  const normalized = value.trim();
  return fileName ? normalized.replace(/\.md$/i, "") : normalized;
}

function titleError(value: string, fileName: boolean) {
  const title = normalizedTitle(value, fileName);
  if (!title) return "Enter a name.";
  if (title.length > 160) return "Keep the name within 160 characters.";
  if (!fileName) {
    return /[\u0000-\u001f]/.test(title)
      ? "That name contains a control character."
      : undefined;
  }
  if (title === "." || title === ".." || title.startsWith(".")) {
    return "Names cannot begin with a dot.";
  }
  if (/[<>:"/\\|?*]/.test(title) || /[\u0000-\u001f]/.test(title)) {
    return "That name contains a reserved character.";
  }
  if (/[. ]$/.test(title)) return "Names cannot end with a dot or space.";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(title)) {
    return "That name is reserved by Windows.";
  }
  return undefined;
}

/** Loaded only after a mathematical object type has been chosen. */
export default function LandmarkCreationForm({
  icon,
  kindLabel,
  fileName = true,
  onCreate,
  onBack,
  onCancel,
}: LandmarkCreationFormProps) {
  const [title, setTitle] = useState(() => `Untitled ${kindLabel.toLocaleLowerCase("en")}`);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (submitting) return;
    const normalized = normalizedTitle(title, fileName);
    const validationError = titleError(normalized, fileName);
    if (validationError) {
      setError(validationError);
      return;
    }
    setTitle(normalized);
    setError(undefined);
    setSubmitting(true);
    try {
      await onCreate(normalized);
    } catch (cause) {
      setSubmitting(false);
      setError(cause instanceof Error ? cause.message : "The object could not be created.");
    }
  };

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!error) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [error]);

  return (
    <div className="map-tool-panel map-create-name">
      <div className="map-create-name__kind" aria-hidden="true">
        {icon}
        <span>{kindLabel}</span>
      </div>
      <form
        className="map-create-name__form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <button
          type="button"
          className="map-create-name__back"
          aria-label="Back to object types"
          title="Back"
          disabled={submitting}
          onClick={onBack}
        >
          <ArrowLeft size={15} aria-hidden="true" />
        </button>
        <input
          ref={inputRef}
          type="text"
          aria-label={`${kindLabel} name`}
          aria-invalid={Boolean(error)}
          value={title}
          maxLength={163}
          spellCheck={false}
          disabled={submitting}
          onChange={(event) => {
            setTitle(event.currentTarget.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
        />
        <button
          type="submit"
          className="map-create-name__submit"
          aria-label={`Create ${kindLabel.toLocaleLowerCase("en")}`}
          title="Create"
          disabled={submitting}
        >
          {submitting
            ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
            : <Check size={15} aria-hidden="true" />}
        </button>
      </form>
      {error && <p className="map-create-name__error" role="alert">{error}</p>}
    </div>
  );
}
