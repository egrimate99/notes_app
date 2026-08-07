import { describe, expect, it } from "vitest";
import {
  buildCanvasConnectionSnapHints,
  buildCanvasMovementGesture,
  resolveCanvasMovementSnap,
  type CanvasMovingSelection,
  type CanvasSnapTarget,
} from "./canvasMovementSnap";
import { objectShapePortAnchors } from "./mapAppearance";

const moving: CanvasMovingSelection = {
  rect: { x: 10, y: 20, width: 100, height: 60 },
  ids: ["moving"],
  kind: "theorem",
  role: "item",
  parentId: "group-a",
};

function target(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 60,
  extra: Partial<CanvasSnapTarget> = {},
): CanvasSnapTarget {
  return { id, rect: { x, y, width, height }, ...extra };
}

function resolve(overrides: Partial<Parameters<typeof resolveCanvasMovementSnap>[0]> = {}) {
  return resolveCanvasMovementSnap({
    moving,
    stationary: [],
    zoom: 1,
    rawDelta: { x: 0, y: 0 },
    gridSize: 28,
    options: { gridMode: "off" },
    ...overrides,
  });
}

describe("buildCanvasConnectionSnapHints", () => {
  it("uses the exact rendered port basis for landmarks and stretched group frames", () => {
    const movingTarget = target("moving", 10, 20, 200, 80, {
      role: "item",
      shape: "parallelogram",
    });
    const groupTarget = target("group", 400, 300, 400, 200, {
      role: "container",
      shape: "parallelogram",
    });
    const [hint] = buildCanvasConnectionSnapHints({
      connections: [{
        id: "vertical",
        source: "moving",
        target: "group",
        sourceHandle: "top",
        targetHandle: "bottom",
      }],
      targets: [movingTarget, groupTarget],
      movingIds: new Set(["moving"]),
    });
    const landmarkTop = objectShapePortAnchors("parallelogram", 200, 80).top;
    const normalizedGroupBottom = objectShapePortAnchors("parallelogram", 100, 100).bottom;

    expect(hint).toMatchObject({
      id: "vertical",
      movingId: "moving",
      targetId: "group",
      axis: "x",
    });
    expect(hint.movingPoint.x).toBeCloseTo(10 + 200 * landmarkTop.x / 100, 10);
    expect(hint.targetPoint.x).toBeCloseTo(400 + 400 * normalizedGroupBottom.x / 100, 10);
  });

  it("freezes live geometry, multi-selection bounds, and incident ports together", () => {
    const gesture = buildCanvasMovementGesture({
      targets: [
        target("first", 0, 0, 100, 60, { role: "item", parentId: "group" }),
        target("second", 120, 20, 80, 40, { role: "item", parentId: "group" }),
        target("stationary", 400, 50, 100, 60, { role: "item", parentId: "group" }),
      ],
      liveNodes: [{
        id: "stationary",
        position: { x: 420, y: 70 },
        measured: { width: 120, height: 80 },
      }],
      positions: new Map([
        ["first", { x: 10, y: 10 }],
        ["second", { x: 150, y: 30 }],
      ]),
      snapNodeIds: new Set(["first", "second"]),
      connections: [{
        id: "incident",
        source: "second",
        target: "stationary",
        sourceHandle: "right",
        targetHandle: "left",
      }],
    });

    expect(gesture?.moving).toMatchObject({
      rect: { x: 10, y: 10, width: 220, height: 60 },
      ids: ["first", "second"],
      role: "item",
      parentId: "group",
    });
    expect(gesture?.stationary.find(({ id }) => id === "stationary")?.rect).toEqual({
      x: 420,
      y: 70,
      width: 120,
      height: 80,
    });
    expect(gesture?.connections[0]).toMatchObject({
      id: "incident",
      movingId: "second",
      targetId: "stationary",
      axis: "y",
      movingPoint: { x: 230, y: 50 },
      targetPoint: { x: 420, y: 110 },
    });
  });

  it("ignores internal edges and preserves non-opposing fixed handles", () => {
    const targets = [
      target("moving", 0, 0),
      target("also-moving", 200, 0),
      target("stationary", 400, 0),
    ];
    const hints = buildCanvasConnectionSnapHints({
      connections: [
        {
          id: "internal",
          source: "moving",
          target: "also-moving",
          sourceHandle: "right",
          targetHandle: "left",
        },
        {
          id: "fixed-same-side",
          source: "moving",
          target: "stationary",
          sourceHandle: "right",
          targetHandle: "right",
        },
      ],
      targets,
      movingIds: ["moving", "also-moving"],
    });

    expect(hints).toEqual([]);
  });
});

describe("resolveCanvasMovementSnap", () => {
  it("settles both axes exactly on the grid by default", () => {
    const result = resolveCanvasMovementSnap({
      moving,
      stationary: [],
      zoom: 1,
      rawDelta: { x: 22, y: 23 },
      gridSize: 28,
    });

    expect(result.delta).toEqual({ x: 18, y: 36 });
    expect(result.rect.x % 28).toBe(0);
    expect(result.rect.y % 28).toBe(0);
    expect(result.snapped.x?.kind).toBe("grid");
    expect(result.guides).toEqual([]);
  });

  it("supports optional magnetic and disabled grid modes", () => {
    const magneticNear = resolve({
      rawDelta: { x: 16, y: 0 },
      options: { gridMode: "magnetic" },
    });
    const magneticFar = resolve({
      rawDelta: { x: 9, y: 0 },
      options: { gridMode: "magnetic" },
    });
    const off = resolve({
      rawDelta: { x: 16, y: 13 },
      options: { gridMode: "off" },
    });

    expect(magneticNear.delta.x).toBe(18);
    expect(magneticFar.delta.x).toBe(9);
    expect(off.delta).toEqual({ x: 16, y: 13 });
  });

  it("uses a screen-constant acquisition radius at every zoom", () => {
    const stationary = [target("peer", 116, 20)];
    const atOne = resolve({
      stationary,
      zoom: 1,
      rawDelta: { x: 100, y: 0 },
    });
    const atTwo = resolve({
      stationary,
      zoom: 2,
      rawDelta: { x: 100, y: 0 },
    });

    expect(atOne.delta.x).toBe(106);
    expect(atOne.snapped.x?.kind).toBe("alignment");
    expect(atTwo.delta.x).toBe(100);
    expect(atTwo.snapped.x).toBeUndefined();
  });

  it("keeps an exact half-grid smart alignment instead of post-processing it onto the grid", () => {
    const result = resolveCanvasMovementSnap({
      moving: { rect: { x: 0, y: 0, width: 100, height: 60 } },
      stationary: [target("odd-width-peer", 200, 0, 101)],
      zoom: 1,
      rawDelta: { x: 200.5, y: 0 },
      gridSize: 28,
    });

    expect(result.delta.x).toBe(200.5);
    expect(result.snapped.x).toMatchObject({
      kind: "alignment",
      movingAnchor: "center",
    });
  });

  it.each([
    ["left", 210, 180, 195] as const,
    ["center", 190, 140, 195] as const,
    ["right", 130, 180, 195] as const,
  ])("aligns horizontal %s anchors", (anchor, targetX, width, rawX) => {
    const result = resolve({
      stationary: [target("peer", targetX, 20, width)],
      rawDelta: { x: rawX, y: 0 },
    });

    expect(result.delta.x).toBe(200);
    expect(result.snapped.x).toMatchObject({
      kind: "alignment",
      movingAnchor: anchor,
      targetAnchor: anchor,
    });
  });

  it.each([
    ["top", 190, 100, 163] as const,
    ["middle", 160, 120, 163] as const,
    ["bottom", 150, 100, 163] as const,
  ])("aligns vertical %s anchors", (anchor, targetY, height, rawY) => {
    const result = resolve({
      stationary: [target("peer", 10, targetY, 100, height)],
      rawDelta: { x: 0, y: rawY },
    });

    expect(result.delta.y).toBe(170);
    expect(result.snapped.y).toMatchObject({
      kind: "alignment",
      movingAnchor: anchor,
      targetAnchor: anchor,
    });
  });

  it("combines independent horizontal and vertical magnets", () => {
    const result = resolve({
      stationary: [
        target("horizontal-peer", 214, 500),
        target("vertical-peer", 500, 192),
      ],
      rawDelta: { x: 198, y: 166 },
    });

    expect(result.delta).toEqual({ x: 204, y: 172 });
    expect(result.guides.map(({ axis, kind }) => [axis, kind])).toEqual([
      ["x", "alignment"],
      ["y", "alignment"],
    ]);
    expect(result.guides.every(({ lines }) => lines.length > 0)).toBe(true);
  });

  it("prioritizes an exact connection-port axis over incidental frame alignment", () => {
    const result = resolve({
      stationary: [
        target("connected", 300, 130, 100, 80, { role: "item", parentId: "group-a" }),
        target("edge-peer", 0, 135, 100, 60, { role: "item", parentId: "group-a" }),
      ],
      connections: [{
        id: "edge-1",
        movingId: "moving",
        targetId: "connected",
        axis: "y",
        movingPoint: { x: 110, y: 50 },
        targetPoint: { x: 300, y: 170 },
      }],
      rawDelta: { x: 0, y: 115 },
    });

    expect(result.delta.y).toBe(120);
    expect(result.snapped.y).toMatchObject({
      kind: "connection",
      targetIds: ["connected"],
      movingAnchor: "connection-port",
      targetAnchor: "connection-port",
    });
    expect(result.guides).toEqual([expect.objectContaining({
      kind: "connection",
      axis: "y",
      movingAnchor: "connection-port",
      targetAnchor: "connection-port",
      lines: [{ x1: 110, y1: 170, x2: 300, y2: 170 }],
    })]);
  });

  it("does not offer a connection hint whose target also belongs to the moving selection", () => {
    const result = resolve({
      moving: { ...moving, ids: ["moving", "also-moving"] },
      stationary: [target("also-moving", 300, 130, 100, 80)],
      connections: [{
        id: "internal-edge",
        movingId: "moving",
        targetId: "also-moving",
        axis: "y",
        movingPoint: { x: 110, y: 50 },
        targetPoint: { x: 300, y: 170 },
      }],
      rawDelta: { x: 0, y: 115 },
    });

    expect(result.snapped.y).toBeUndefined();
    expect(result.guides).toEqual([]);
  });

  it("suppresses an already-satisfied unrelated-axis guide", () => {
    const result = resolve({
      stationary: [target("peer", 110, 20)],
      rawDelta: { x: 96, y: 0 },
    });

    expect(result.snapped.x?.kind).toBe("alignment");
    expect(result.snapped.y).toMatchObject({ kind: "alignment", correction: 0 });
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]).toMatchObject({
      axis: "x",
      movingAnchor: "center",
      targetAnchor: "center",
    });
  });

  it("does not add a zero-correction containment line beside a connection guide", () => {
    const result = resolve({
      stationary: [
        target("group-a", 0, -100, 400, 300, { role: "container" }),
        target("connected", 165, -200, 100, 60, { role: "item", parentId: "group-a" }),
      ],
      connections: [{
        id: "vertical-edge",
        movingId: "moving",
        targetId: "connected",
        axis: "x",
        movingPoint: { x: 60, y: 20 },
        targetPoint: { x: 165, y: -140 },
      }],
      rawDelta: { x: 103, y: 0 },
    });

    expect(result.snapped.x?.kind).toBe("connection");
    expect(result.snapped.y).toMatchObject({ kind: "containment", correction: 0 });
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0].kind).toBe("connection");
  });

  it("centers a smaller item inside a container on either axis", () => {
    const group = target("group-a", 0, 0, 400, 300, { role: "container" });
    const result = resolve({
      stationary: [group],
      rawDelta: { x: 136, y: 102 },
    });

    expect(result.delta).toEqual({ x: 140, y: 100 });
    expect(result.snapped.x).toMatchObject({ kind: "containment", targetIds: ["group-a"] });
    expect(result.snapped.y).toMatchObject({ kind: "containment", targetIds: ["group-a"] });
    expect(result.guides).toHaveLength(2);
    expect(result.guides[0].lines[0]).toEqual({ x1: 200, y1: 132, x2: 200, y2: 168 });
  });

  it("caps a one-axis containment centre cue instead of crossing a huge group", () => {
    const result = resolve({
      stationary: [target("group-a", 0, 0, 400, 1_000, { role: "container" })],
      rawDelta: { x: 136, y: 0 },
    });

    const xGuide = result.guides.find(({ axis }) => axis === "x");
    expect(xGuide?.kind).toBe("containment");
    expect(xGuide?.lines).toEqual([{ x1: 200, y1: 38, x2: 200, y2: 258 }]);
  });

  it("does not offer containment for a non-container or an undersized group", () => {
    const result = resolve({
      stationary: [
        target("plain", 0, 0, 400, 300),
        target("small", 140, 100, 50, 40, { role: "container" }),
      ],
      rawDelta: { x: 136, y: 102 },
    });

    expect(Object.values(result.snapped).every((snap) => snap.kind !== "containment")).toBe(true);
  });

  it("focuses containment on the smallest visible nested destination", () => {
    const result = resolve({
      stationary: [
        target("group-a", 0, 0, 400, 300, { role: "container" }),
        target("smaller-overlap", 100, 70, 180, 160, { role: "container" }),
      ],
      rawDelta: { x: 134, y: 100 },
    });

    expect(result.snapped.x).toMatchObject({
      kind: "containment",
      targetIds: ["smaller-overlap"],
      delta: 130,
    });
    expect(result.snapped.y).toMatchObject({
      kind: "containment",
      targetIds: ["smaller-overlap"],
      delta: 100,
    });
  });

  it("uses the smallest eligible container after leaving the direct parent", () => {
    const result = resolve({
      stationary: [
        target("group-a", 0, 0, 300, 300, { role: "container" }),
        target("large-destination", 380, -20, 260, 240, { role: "container" }),
        target("small-destination", 400, 0, 200, 200, { role: "container" }),
      ],
      rawDelta: { x: 440, y: 50 },
    });

    expect(result.snapped.x).toMatchObject({
      kind: "containment",
      targetIds: ["small-destination"],
      delta: 440,
    });
    expect(result.snapped.y).toMatchObject({
      kind: "containment",
      targetIds: ["small-destination"],
      delta: 50,
    });
  });

  it("uses the visible shape rather than its bounding box for containment focus", () => {
    const result = resolve({
      moving: {
        rect: { x: 0, y: 0, width: 20, height: 20 },
        ids: ["moving"],
        role: "item",
      },
      stationary: [target("oval", 0, 0, 400, 300, {
        role: "container",
        shape: "oval",
      })],
      rawDelta: { x: 28, y: 28 },
    });

    expect(result.delta).toEqual({ x: 28, y: 28 });
    expect(result.snapped).toEqual({});
    expect(result.guides).toEqual([]);
  });

  it("suppresses rectangular inset magnets for a non-rectangular container", () => {
    const result = resolve({
      moving: {
        rect: { x: 0, y: 0, width: 20, height: 20 },
        ids: ["moving"],
        role: "item",
      },
      stationary: [target("oval", 0, 0, 400, 300, {
        role: "container",
        shape: "oval",
      })],
      rawDelta: { x: 28, y: 140 },
    });

    expect(result.snapped.x).toBeUndefined();
    expect(result.delta.x).toBe(28);
    expect(result.snapped.y).toMatchObject({
      kind: "containment",
      movingAnchor: "middle",
      targetIds: ["oval"],
    });
  });

  it("retains inset assistance for rounded rectangular containers", () => {
    const result = resolve({
      stationary: [target("rounded", 0, 0, 400, 300, {
        role: "container",
        shape: "rounded-rectangle",
      })],
      rawDelta: { x: 24, y: 70 },
    });

    expect(result.snapped.x).toMatchObject({
      kind: "containment",
      movingAnchor: "left",
      targetIds: ["rounded"],
      delta: 18,
    });
  });

  it("does not use a container frame as an ordinary item-alignment peer", () => {
    const result = resolve({
      stationary: [target("far-container", 110, 500, 100, 60, {
        role: "container",
        parentId: "group-a",
      })],
      rawDelta: { x: 96, y: 0 },
    });

    expect(result.delta.x).toBe(96);
    expect(result.snapped.x).toBeUndefined();
  });

  it("aligns only with an ordinary peer from the same explicit parent", () => {
    const mismatched = resolve({
      stationary: [target("other-parent", 110, 20, 100, 60, {
        role: "item",
        parentId: "group-b",
      })],
      rawDelta: { x: 96, y: 0 },
    });
    const sibling = resolve({
      stationary: [target("sibling", 110, 20, 100, 60, {
        role: "item",
        parentId: "group-a",
      })],
      rawDelta: { x: 96, y: 0 },
    });

    expect(mismatched.snapped.x).toBeUndefined();
    expect(mismatched.delta.x).toBe(96);
    expect(sibling.snapped.x).toMatchObject({ kind: "alignment", targetIds: ["sibling"] });
  });

  it.each([
    ["left", { x: 24, y: 70 }, { x: 18, y: 70 }, 28] as const,
    ["right", { x: 264, y: 70 }, { x: 262, y: 70 }, 372] as const,
    ["top", { x: 140, y: 14 }, { x: 140, y: 8 }, 28] as const,
    ["bottom", { x: 140, y: 194 }, { x: 140, y: 192 }, 272] as const,
  ])("snaps to a container's one-grid inner %s inset", (anchor, rawDelta, expectedDelta, coordinate) => {
    const result = resolve({
      stationary: [target("group", 0, 0, 400, 300, { kind: "group" })],
      rawDelta,
    });
    const axis = anchor === "left" || anchor === "right" ? "x" : "y";

    expect(result.delta[axis]).toBe(expectedDelta[axis]);
    expect(result.snapped[axis]).toMatchObject({
      kind: "containment",
      movingAnchor: anchor,
      targetAnchor: `container-inner-${anchor}`,
    });
    const guide = result.guides.find((entry) => entry.axis === axis);
    expect(guide?.kind).toBe("containment");
    const guideLine = guide?.lines[0];
    expect(axis === "x" ? guideLine?.x1 : guideLine?.y1).toBe(coordinate);
  });

  it("inserts a selection at an equal gap and returns two dimension spans", () => {
    const result = resolve({
      stationary: [
        target("left", 0, 20, 80),
        target("right", 240, 20, 80),
      ],
      rawDelta: { x: 101, y: 0 },
    });

    expect(result.delta.x).toBe(100);
    expect(result.snapped.x).toMatchObject({
      kind: "distribution",
      targetIds: ["left", "right"],
      targetAnchor: "equal-gap-between",
    });
    expect(result.guides[0].kind).toBe("distribution");
    expect(result.guides[0].lines).toHaveLength(6);
    expect(result.guides[0].label?.text).toBe("30");
  });

  it("extends an existing sequence using its exact gap", () => {
    const result = resolve({
      stationary: [
        target("first", 0, 20, 80),
        target("second", 108, 20, 80),
      ],
      rawDelta: { x: 200, y: 0 },
    });

    expect(result.delta.x).toBe(206);
    expect(result.snapped.x).toMatchObject({
      kind: "distribution",
      targetAnchor: "repeat-gap-after",
      targetIds: ["first", "second"],
    });
    expect(result.guides[0].label?.text).toBe("28");
  });

  it("offers the same equal-gap insertion assistance vertically", () => {
    const result = resolve({
      stationary: [
        target("above", 10, 0, 100, 40),
        target("below", 10, 180, 100, 40),
      ],
      rawDelta: { x: 0, y: 66 },
    });

    expect(result.delta.y).toBe(60);
    expect(result.snapped.y).toMatchObject({
      kind: "distribution",
      targetAnchor: "equal-gap-between",
      targetIds: ["above", "below"],
    });
    expect(result.guides.find(({ axis }) => axis === "y")?.lines).toHaveLength(6);
  });

  it("does not distribute against objects from another explicit parent", () => {
    const result = resolve({
      stationary: [
        target("left", 0, 20, 80, 60, { role: "item", parentId: "group-b" }),
        target("right", 240, 20, 80, 60, { role: "item", parentId: "group-b" }),
      ],
      rawDelta: { x: 101, y: 0 },
    });

    expect(result.delta.x).toBe(101);
    expect(result.snapped.x).toBeUndefined();
    expect(result.guides).toEqual([]);
  });

  it("prefers semantic centering over a nearly identical edge candidate", () => {
    const result = resolve({
      stationary: [
        target("edge-peer", 109.6, 20),
        target("center-peer", 110, 20),
      ],
      rawDelta: { x: 100, y: 0 },
    });

    expect(result.snapped.x).toMatchObject({
      key: "alignment:x:center:center-peer",
      movingAnchor: "center",
    });
  });

  it("retains an acquired magnet through the larger release radius", () => {
    const stationary = [target("peer", 110, 20)];
    const acquired = resolve({
      stationary,
      rawDelta: { x: 93, y: 0 },
      contextKey: "gesture-1",
    });
    const sticky = resolve({
      stationary,
      rawDelta: { x: 89, y: 0 },
      contextKey: "gesture-1",
      previous: acquired.state,
    });
    const withoutMemory = resolve({
      stationary,
      rawDelta: { x: 89, y: 0 },
      contextKey: "gesture-1",
    });

    expect(acquired.delta.x).toBe(100);
    expect(sticky.delta.x).toBe(100);
    expect(sticky.snapped.x?.sticky).toBe(true);
    expect(withoutMemory.delta.x).toBe(89);
  });

  it("switches away from a lock when a competing guide becomes materially closer", () => {
    const acquired = resolve({
      stationary: [target("original", 110, 20)],
      rawDelta: { x: 96, y: 0 },
      contextKey: "sticky-competition",
    });
    const retained = resolve({
      stationary: [
        target("original", 110, 20),
        target("new-nearer", 114, 20),
      ],
      rawDelta: { x: 105, y: 0 },
      contextKey: "sticky-competition",
      previous: acquired.state,
    });

    expect(retained.snapped.x).toMatchObject({
      targetIds: ["new-nearer"],
      sticky: false,
      delta: 104,
    });
  });

  it("retains a lock through a sub-three-pixel competing improvement", () => {
    const acquired = resolve({
      stationary: [target("original", 110, 20)],
      rawDelta: { x: 96, y: 0 },
      contextKey: "sticky-jitter",
    });
    const retained = resolve({
      stationary: [
        target("original", 110, 20),
        target("slightly-nearer", 112, 20),
      ],
      rawDelta: { x: 102, y: 0 },
      contextKey: "sticky-jitter",
      previous: acquired.state,
    });

    expect(retained.snapped.x).toMatchObject({
      targetIds: ["original"],
      sticky: true,
      delta: 100,
    });
  });

  it("switches an ordinary lock to an acquired connection-port guide", () => {
    const acquired = resolve({
      stationary: [target("ordinary", 10, 120)],
      rawDelta: { x: 0, y: 96 },
      contextKey: "connection-upgrade",
    });
    expect(acquired.snapped.y?.kind).toBe("alignment");

    const upgraded = resolve({
      stationary: [
        target("ordinary", 10, 120),
        target("connected", 300, 115),
      ],
      connections: [{
        id: "edge-upgrade",
        movingId: "moving",
        targetId: "connected",
        axis: "y",
        movingPoint: { x: 110, y: 50 },
        targetPoint: { x: 300, y: 155 },
      }],
      rawDelta: { x: 0, y: 103 },
      contextKey: "connection-upgrade",
      previous: acquired.state,
    });

    expect(upgraded.snapped.y).toMatchObject({
      kind: "connection",
      delta: 105,
      sticky: false,
      targetIds: ["connected"],
    });
  });

  it("switches an edge lock to exact middle alignment for unequal-height peers", () => {
    const unequalPeer = target("unequal", 10, 120, 100, 80);
    const acquired = resolve({
      stationary: [unequalPeer],
      rawDelta: { x: 0, y: 103 },
      contextKey: "edge-to-middle",
    });
    expect(acquired.snapped.y).toMatchObject({
      movingAnchor: "top",
      delta: 100,
    });

    const centred = resolve({
      stationary: [unequalPeer],
      rawDelta: { x: 0, y: 110 },
      contextKey: "edge-to-middle",
      previous: acquired.state,
    });

    expect(centred.snapped.y).toMatchObject({
      movingAnchor: "middle",
      targetAnchor: "middle",
      delta: 110,
      sticky: false,
    });
  });

  it("releases beyond the hysteresis radius and ignores state from another gesture", () => {
    const stationary = [target("peer", 110, 20)];
    const acquired = resolve({
      stationary,
      rawDelta: { x: 94, y: 0 },
      contextKey: "old",
    });
    const released = resolve({
      stationary,
      rawDelta: { x: 85, y: 0 },
      contextKey: "old",
      previous: acquired.state,
    });
    const newGesture = resolve({
      stationary,
      rawDelta: { x: 89, y: 0 },
      contextKey: "new",
      previous: acquired.state,
    });

    expect(released.delta.x).toBe(85);
    expect(released.state.x).toBeUndefined();
    expect(newGesture.delta.x).toBe(89);
  });

  it("Alt bypasses all smart magnets but retains exact grid settling", () => {
    const result = resolveCanvasMovementSnap({
      moving,
      stationary: [target("peer", 110, 20)],
      zoom: 1,
      rawDelta: { x: 96, y: 5 },
      gridSize: 28,
      modifiers: { altKey: true },
      previous: {
        contextKey: "gesture",
        x: { key: "alignment:x:left:peer", kind: "alignment" },
      },
      contextKey: "gesture",
    });

    expect(result.delta).toEqual({ x: 102, y: 8 });
    expect(result.snapped.x?.kind).toBe("grid");
    expect(result.state.x).toBeUndefined();
    expect(result.guides).toEqual([]);
  });

  it.each(["x", "y"] as const)("honours an explicit %s-axis lock before magnets and grid", (axis) => {
    const result = resolveCanvasMovementSnap({
      moving,
      stationary: [target("near-both-axes", 110, 120)],
      zoom: 1,
      rawDelta: { x: 96, y: 96 },
      gridSize: 28,
      modifiers: { axisLock: axis },
    });

    const perpendicular = axis === "x" ? "y" : "x";
    expect(result.delta[perpendicular]).toBe(0);
    expect(result.snapped[perpendicular]).toBeUndefined();
    expect(result.guides.every((guide) => guide.axis === axis)).toBe(true);
  });

  it("can expose grid line primitives without cluttering the default result", () => {
    const result = resolve({
      rawDelta: { x: 18, y: 8 },
      options: { gridMode: "always", showGridGuides: true },
    });

    expect(result.guides).toHaveLength(2);
    expect(result.guides.map(({ kind }) => kind)).toEqual(["grid", "grid"]);
    expect(result.guides[0].lines).toEqual([{ x1: 28, y1: 28, x2: 28, y2: 88 }]);
  });

  it("excludes selected roots and all their stationary descendants", () => {
    const selectedGroup: CanvasMovingSelection = {
      rect: { x: 0, y: 0, width: 200, height: 150 },
      ids: ["selected-group"],
      role: "container",
    };
    const result = resolve({
      moving: selectedGroup,
      stationary: [
        target("selected-group", 100, 100, 200, 150, { role: "container" }),
        target("child-group", 102, 100, 100, 80, {
          role: "container",
          parentId: "selected-group",
        }),
        target("grandchild", 104, 100, 60, 40, { parentId: "child-group" }),
      ],
      rawDelta: { x: 99, y: 99 },
    });

    expect(result.delta).toEqual({ x: 99, y: 99 });
    expect(result.guides).toEqual([]);
  });

  it("is deterministic when stationary targets arrive in a different order", () => {
    const first = target("a", 110, 20);
    const second = target("b", 110, 20);
    const forward = resolve({ stationary: [first, second], rawDelta: { x: 96, y: 0 } });
    const reverse = resolve({ stationary: [second, first], rawDelta: { x: 96, y: 0 } });

    expect(reverse).toEqual(forward);
    expect(forward.snapped.x?.targetIds).toEqual(["a"]);
  });

  it("does not mutate caller-owned geometry", () => {
    const stationary = [target("peer", 110, 20)];
    const frozenMoving = Object.freeze({
      ...moving,
      rect: Object.freeze({ ...moving.rect }),
      ids: Object.freeze(["moving"]),
    });
    const frozenTargets = Object.freeze(stationary.map((entry) => Object.freeze({
      ...entry,
      rect: Object.freeze({ ...entry.rect }),
    })));

    expect(() => resolve({
      moving: frozenMoving,
      stationary: frozenTargets,
      rawDelta: { x: 96, y: 0 },
    })).not.toThrow();
    expect(frozenMoving.rect).toEqual({ x: 10, y: 20, width: 100, height: 60 });
  });

  it("validates connection geometry even while smart magnets are bypassed", () => {
    expect(() => resolve({
      connections: [{
        id: "invalid",
        movingId: "moving",
        targetId: "peer",
        axis: "y",
        movingPoint: { x: Number.NaN, y: 50 },
        targetPoint: { x: 300, y: 170 },
      }],
      modifiers: { altKey: true },
    })).toThrow("connections[0].movingPoint.x");
  });

  it("cleans negative zero from exact grid results", () => {
    const result = resolveCanvasMovementSnap({
      moving: { rect: { x: 0, y: 0, width: 10, height: 10 } },
      stationary: [],
      zoom: 1,
      rawDelta: { x: -0.1, y: -0.1 },
      gridSize: 28,
    });

    expect(Object.is(result.delta.x, -0)).toBe(false);
    expect(Object.is(result.delta.y, -0)).toBe(false);
    expect(result.delta).toEqual({ x: 0, y: 0 });
  });

  it.each([
    [{ zoom: 0 }, "zoom"],
    [{ gridSize: 0 }, "gridSize"],
    [{ rawDelta: { x: Number.NaN, y: 0 } }, "rawDelta.x"],
    [{ moving: { rect: { x: 0, y: 0, width: -1, height: 1 } } }, "dimensions"],
    [{ options: { thresholdPx: 10, releaseThresholdPx: 5 } }, "releaseThresholdPx"],
  ])("rejects invalid geometry or configuration (%s)", (override, message) => {
    expect(() => resolve(override)).toThrow(message);
  });
});
