# File-backed atlas state

The canvas has one canonical writable metadata file:

```text
study/content/.math-atlas/atlas.json
```

The hidden directory is deliberately omitted from `/api/content/tree`; it is not
a note and never touches the external Obsidian vault. Like the rest of
`content/`, it is private local state and is excluded from version control.

## Client API

`atlasRepository` implements the typed `AtlasRepository` interface from
`src/services/atlasRepository.ts`:

```ts
const opened = await atlasRepository.readAtlas("example-atlas-v1");
const { atlas, revision, recovery } = opened;

const saved = await atlasRepository.writeAtlas(nextAtlas, revision);
```

- `GET /api/atlas?snapshotKey=example-atlas-v1` returns an
  `AtlasMetadataDocument`.
- `PUT /api/atlas` accepts `{ atlas, expectedRevision }` and returns the saved
  `AtlasMetadataDocument`.
- Use `expectedRevision: null` only when creating the file.
- A stale token returns HTTP 409 with `error.currentRevision`; reload before
  applying the user's edit again.

Missing or damaged files produce a valid empty `atlas` plus a `recovery`
descriptor. A damaged file still has a revision, so it can only be replaced by
an explicit revision-checked write. Reads never silently rewrite disk state.

## Legacy migration

`migrateLegacyAtlasState(mapCustomizations, placements)` in
`src/services/atlasMigration.ts` combines the two existing localStorage models
into a validated `AtlasMetadata` document. `atlasMetadataToLegacyState` is the
temporary adapter back to the current `App` state shape.

The intended one-time integration sequence is:

1. Read the file-backed atlas.
2. If `recovery.reason === "missing"`, migrate the current localStorage state and
   create the file with a null revision.
3. Hydrate `App` using `atlasMetadataToLegacyState`.
4. Debounce map edits into `writeAtlas`, always carrying forward the returned
   revision.
5. On a 409, retain the unsaved local edit, reload, and surface a merge/retry
   choice rather than overwriting disk.

The migration helper exists now, but no automatic migration is wired into the UI
yet. This prevents an unreviewed empty or partially loaded map from replacing the
user's current browser state.

## Disk guarantees

- Strict schema validation and bounded collections/coordinates.
- UTF-8 JSON with stable indentation and a trailing newline.
- SHA-256 opaque revisions.
- Per-process write serialization and a second revision check immediately before
  replacement.
- Temporary file `fsync`, same-directory atomic rename, and best-effort directory
  `fsync`.
- Symlinks are rejected for the content root, metadata directory, and metadata
  file.
- Temporary files are removed after success or failure.
