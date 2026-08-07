const appUrl = process.env.MATH_ATLAS_URL || "http://127.0.0.1:1420";
const expectedSubjectCount = 7;
const subjectShape = "rounded-rectangle";
const excludedRootDirectories = new Set(
  (process.env.MATH_ATLAS_EXCLUDED_ROOTS ?? "")
    .split(",")
    .map((name) => name.trim().toLocaleLowerCase("en"))
    .filter(Boolean),
);
const frameSpecs = [
  { style: "double-rule", titlePosition: "top-left" },
  { style: "triple-rule", titlePosition: "top-left" },
  { style: "cardinal-ticks", titlePosition: "top-left" },
  { style: "corner-brackets", titlePosition: "top-left" },
  { style: "dashed-inset", titlePosition: "top-left" },
  { style: "beaded", titlePosition: "top-left" },
  { style: "offset-rails", titlePosition: "top-left" },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function subjectIdForDirectory(directory) {
  return directory
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLocaleLowerCase("en")
    .slice(0, 120);
}

function visibleRootDirectories(tree) {
  return tree.filter((entry) => {
    if (entry.type !== "directory") return false;
    const path = entry.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return !path.includes("/") &&
      !path.startsWith("_") &&
      !excludedRootDirectories.has(path.toLocaleLowerCase("en"));
  });
}

function finiteBounds(items) {
  const valid = items.filter((item) => (
    Number.isFinite(item.x) && Number.isFinite(item.y) &&
    Number.isFinite(item.width) && Number.isFinite(item.height)
  ));
  if (!valid.length) return { minY: 0, maxX: 0 };
  return {
    minY: Math.min(...valid.map(({ y }) => y)),
    maxX: Math.max(...valid.map(({ x, width }) => x + width)),
  };
}

function uniqueGroupId(subjectId, occupiedIds) {
  const base = `subject-frame-${subjectId}`;
  if (!occupiedIds.has(base)) return base;
  let suffix = 2;
  while (occupiedIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function reconcileSubjects(atlas, roots) {
  const customizations = atlas.customizations;
  assert(customizations && Array.isArray(customizations.customGroups), "Atlas custom groups are unavailable.");
  const subjectIds = roots.map(({ path }) => subjectIdForDirectory(path));
  assert(subjectIds.every(Boolean), "A visible folder could not be mapped to a subject id.");
  assert(new Set(subjectIds).size === roots.length, "Visible folders map to duplicate subject ids.");
  assert(frameSpecs.length === roots.length, "The subject frame specification count is out of sync.");
  assert(new Set(frameSpecs.map(({ style }) => style)).size === roots.length, "Subject frame styles must be unique.");

  const groups = [...customizations.customGroups];
  const subjectIndex = new Map();
  const relevantSubjectIds = new Set(subjectIds);
  groups.forEach((group, index) => {
    if (group.level !== "subject" || !relevantSubjectIds.has(group.subjectId)) return;
    assert(!subjectIndex.has(group.subjectId), "A visible folder has duplicate subject frames; no atlas changes were written.");
    subjectIndex.set(group.subjectId, index);
  });
  const occupiedIds = new Set(groups.map(({ id }) => id));
  const bounds = finiteBounds([
    ...groups,
    ...(customizations.customLandmarks ?? []),
  ]);
  const newWidth = 3_600;
  const newHeight = 3_200;
  const bankX = Math.ceil((bounds.maxX + 800) / 28) * 28;
  const bankY = Math.floor(bounds.minY / 28) * 28;
  let added = 0;
  let updated = 0;

  roots.forEach((root, index) => {
    const subjectId = subjectIds[index];
    const spec = frameSpecs[index];
    const existingIndex = subjectIndex.get(subjectId);
    if (existingIndex !== undefined) {
      const existing = groups[existingIndex];
      const next = {
        ...existing,
        shape: subjectShape,
        subjectFrameStyle: spec.style,
      };
      groups[existingIndex] = next;
      if (existing.shape !== next.shape || existing.subjectFrameStyle !== next.subjectFrameStyle) {
        updated += 1;
      }
      return;
    }

    const appearance = {
      title: root.name,
      subjectId,
      level: "subject",
      color: "#92989F",
      shape: subjectShape,
      borderStyle: "solid",
      borderWeight: "strong",
      fillOpacity: 0,
      titlePosition: spec.titlePosition,
      titleFontSize: 34,
      subjectFrameStyle: spec.style,
    };

    const id = uniqueGroupId(subjectId, occupiedIds);
    occupiedIds.add(id);
    groups.push({
      id,
      ...appearance,
      x: bankX,
      y: bankY + added * (newHeight + 800),
      width: newWidth,
      height: newHeight,
    });
    added += 1;
  });

  return {
    atlas: {
      ...atlas,
      customizations: { ...customizations, customGroups: groups },
    },
    added,
    updated,
  };
}

async function readJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

const tree = await readJson(`${appUrl}/api/content/tree`);
const roots = visibleRootDirectories(tree);
assert(
  roots.length === expectedSubjectCount,
  `Expected ${expectedSubjectCount} visible root folders, found ${roots.length}. ` +
    "Set MATH_ATLAS_EXCLUDED_ROOTS to a comma-separated list of local non-subject folders; no atlas changes were written.",
);

let saved;
for (let attempt = 0; attempt < 3; attempt += 1) {
  const opened = await readJson(`${appUrl}/api/atlas?snapshotKey=math-atlas-v1`);
  const reconciled = reconcileSubjects(opened.atlas, roots);
  try {
    saved = await readJson(`${appUrl}/api/atlas`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ atlas: reconciled.atlas, expectedRevision: opened.revision }),
    });
    console.log(
      `[sync:subject-frames] ${roots.length} visible folders covered; ${reconciled.updated} existing subjects updated; ${reconciled.added} subjects added.`,
    );
    break;
  } catch (error) {
    if (error.status !== 409 || attempt === 2) throw error;
  }
}

assert(saved?.revision, "The atlas write did not return a revision.");
const verified = await readJson(`${appUrl}/api/atlas?snapshotKey=math-atlas-v1`);
const expectedIds = new Set(roots.map(({ path }) => subjectIdForDirectory(path)));
const verifiedSubjects = verified.atlas.customizations.customGroups.filter((group) => (
  group.level === "subject" && expectedIds.has(group.subjectId)
));
assert(verifiedSubjects.length === expectedSubjectCount, "The saved atlas does not contain seven matching subjects.");
assert(verifiedSubjects.every(({ shape }) => shape === subjectShape), "A saved subject is not using the shared cloud rectangle.");
assert(new Set(verifiedSubjects.map(({ subjectFrameStyle }) => subjectFrameStyle)).size === expectedSubjectCount, "Saved subject frames are not unique.");
console.log(`[sync:subject-frames] One shared cloud silhouette with seven distinct neutral title icons persisted at revision ${saved.revision}.`);
