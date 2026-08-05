# Full Obsidian vault import

The full-vault importer is a deliberate, one-way replacement of Math Atlas's
canonical note tree. It never writes to the external Obsidian vault and it
never imports an Obsidian Canvas. Imported notes begin off-canvas so the map can
be authored deliberately.

## Source expectations

Vault inventories are private and vary by installation. Supply the source path
and reviewed safety counts explicitly on the command line; do not publish a
dry-run report or import manifest. Dot-directories such as `.git`, `.obsidian`,
and `.trash` are never traversed, and Canvas and PDF files are intentionally
skipped. The source's folder spelling and case are preserved.

Imported notes, assets, manifests, backups, and atlas state all remain below
`content/`. That directory is private local data and is excluded from version
control in the public repository.

## Safe workflow

The default mode is read-only and writes nothing:

```powershell
npm run import:vault -- --dry-run `
  --vault '<external-vault-path>' `
  --expected-notes <count> `
  --expected-assets <count> `
  --expected-note-links <count>
```

The explicit equivalent, with a machine-readable report, is:

```powershell
npm run import:vault -- --dry-run --json `
  --vault '<external-vault-path>' `
  --expected-notes <count> `
  --expected-assets <count> `
  --expected-note-links <count>
```

Review the counts and source digest before promotion. Promotion is never
implicit:

```powershell
npm run import:vault -- --apply `
  --vault '<external-vault-path>' `
  --expected-notes <count> `
  --expected-assets <count> `
  --expected-note-links <count>
```

The apply workflow performs these steps:

1. recursively enumerate the live source filesystem while ignoring dot-folders
   and refusing links or junctions;
2. stable-read every source through a read-only file handle, retrying a file if
   its identity, size, or timestamps change during the read;
3. validate portable paths, strict UTF-8, normalized-path collisions, stable ID
   uniqueness, all wikilinks, and every image reference;
4. preserve existing frontmatter and note bodies while inserting a deterministic
   `id` when one is absent;
5. resolve images relative to their note first, then by a unique vault-wide
   basename; store their bytes content-addressed under `content/.assets` and
   rewrite both Markdown images and Obsidian image embeds;
6. build the entire replacement below a hidden staging directory inside
   `content`, including an empty `.math-atlas/atlas.json`;
7. verify every staged note hash, stable ID, link, image hash, image reference,
   and empty-canvas invariant;
8. journal each rename before it happens, preserve Math Atlas's recoverable
   `content/.trash`, move the previous canonical tree into
   `content/.obsidian-import-backups/<transaction-id>/previous`, and promote the
   staged tree;
9. verify the promoted tree again and automatically roll back if verification
   fails.

The source and destination must be disjoint. Importing into the source vault or
into one of its parents or children is rejected.

## Verification and recovery

Verify the current canonical tree against its saved manifest at any time:

```powershell
npm run import:vault -- --verify
```

The manifest lives at `content/.math-atlas/import-manifest.json`. It records the
source digest, every source and canonical note hash, stable IDs, aliases, every
asset hash and source path, expected counts, and the empty atlas hash. It is an
integrity manifest, not a second copy of the notes.

The previous tree remains recoverable after a successful import. Restore the
most recent import backup with:

```powershell
npm run import:vault -- --rollback latest
```

Or restore a specific transaction printed by `--apply`:

```powershell
npm run import:vault -- --rollback <transaction-id>
```

Rollback never deletes the imported replacement. It moves that tree into the
selected hidden backup before restoring the previous tree. The same rollback
command can recover a journalled import interrupted during its commit phase.

## Reviewed count changes

The counts are command-line safety assertions. If the source changes, run a
dry-run with explicitly reviewed expectations rather than silently accepting
drift:

```powershell
npm run import:vault -- --dry-run `
  --vault '<external-vault-path>' `
  --expected-notes <count> `
  --expected-assets <count> `
  --expected-note-links <count>
```

Use the same reviewed expectations with `--apply`. This importer is not a
refresh or merge workflow: subsequent Math Atlas edits are canonical only below
`study/content`.
