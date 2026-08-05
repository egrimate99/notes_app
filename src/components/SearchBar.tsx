import { Search, X } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

interface SearchBarProps {
  searchQuery: string;
  resultCount: number;
  onSearch: (query: string) => void;
  compact?: boolean;
}

export const SearchBar = memo(function SearchBar({
  searchQuery,
  resultCount,
  onSearch,
  compact = false,
}: SearchBarProps) {
  const searchInput = useRef<HTMLInputElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(Boolean(searchQuery));

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest(".cm-editor") ||
          target.matches("input, textarea, select, [contenteditable='true']"))
      ) {
        return;
      }

      event.preventDefault();
      setExpanded(true);
      requestAnimationFrame(() => searchInput.current?.focus());
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <div
      ref={shell}
      className={`search-bar${expanded ? " is-expanded" : ""}${compact ? " is-compact" : ""}`}
      onBlur={(event) => {
        if (!searchQuery && !event.currentTarget.contains(event.relatedTarget)) {
          setExpanded(false);
        }
      }}
    >
      <button
        type="button"
        className="atlas-search-trigger"
        aria-label="Search notes"
        title="Search · Ctrl K"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded(true);
          requestAnimationFrame(() => searchInput.current?.focus());
        }}
      >
        <Search size={15} aria-hidden="true" />
      </button>
      <div className="atlas-search" aria-hidden={!expanded}>
        <input
          ref={searchInput}
          value={searchQuery}
          onChange={(event) => onSearch(event.currentTarget.value)}
          aria-label="Search notes"
          tabIndex={expanded ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onSearch("");
            setExpanded(false);
            shell.current?.querySelector<HTMLButtonElement>(".atlas-search-trigger")?.focus();
          }}
        />
        {searchQuery && (
          <output className="atlas-search-count" aria-label={`${resultCount} results`}>
            {resultCount}
          </output>
        )}
        {searchQuery && (
          <button
            type="button"
            className="atlas-search-clear"
            aria-label="Clear search"
            onClick={() => {
              onSearch("");
              searchInput.current?.focus();
            }}
          >
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
});
