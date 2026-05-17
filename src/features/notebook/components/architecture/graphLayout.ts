/**
 * Layout for C4 / Deployment / ERD diagrams.
 *
 * - C4 Context / Container: simple layered placement. Persons on the left,
 *   the SUT in the middle (with a dashed system-boundary group), external
 *   systems on the right.
 * - C4 Component: components inside one focal container — fixed grid inside
 *   the container box.
 * - Deployment: a tree of nested rectangles (Cloud → Region → Cluster → …).
 * - ERD: entities laid out on a coarse grid; relations are arrows with
 *   cardinality labels.
 *
 * Output is a flat list of React Flow nodes (groups first for z-order) plus
 * edges with handles picked based on relative position.
 */

import { type Edge, type Node, MarkerType, Position } from "@xyflow/react";
import type { ArchitectureDiagram, ArchitectureElement, ArchitectureElementKind } from "../../types/notebook";
import type { ArchitectureRelationEdgeData } from "./ArchitectureRelationEdge";
import type { ArchitectureGroupNodeData } from "./ArchitectureGroupNode";
import type { ArchitectureShapeNodeData } from "./ArchitectureShapeNode";

// ── Visual constants ──────────────────────────────────────────────────

const COL_WIDTH = 280;
const ROW_HEIGHT = 150;
const ENTITY_ROW_HEIGHT = 220;
const TOP_PADDING = 60;
const LEFT_PADDING = 40;
const GROUP_PADDING = 32;

const ELEMENT_SIZE: Record<ArchitectureElementKind, { width: number; height: number }> = {
  person: { width: 140, height: 110 },
  system: { width: 220, height: 110 },
  "external-system": { width: 200, height: 100 },
  container: { width: 200, height: 110 },
  component: { width: 180, height: 90 },
  "deployment-node": { width: 240, height: 140 },
  actor: { width: 160, height: 60 },
  entity: { width: 220, height: 160 },
};

// ── Public types ──────────────────────────────────────────────────────

export type ArchitectureFlowNode =
  | Node<ArchitectureShapeNodeData, "architectureShape">
  | Node<ArchitectureGroupNodeData, "architectureGroup">;

export interface GraphFlowResult {
  nodes: ArchitectureFlowNode[];
  edges: Edge<ArchitectureRelationEdgeData>[];
  width: number;
  height: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

function elementSize(kind: ArchitectureElementKind, fieldsCount = 0): { width: number; height: number } {
  if (kind === "entity") {
    // Grow entity height with the number of fields (header + per-field row).
    const rowH = 22;
    return { width: 240, height: Math.max(80, 48 + fieldsCount * rowH) };
  }
  return ELEMENT_SIZE[kind] ?? ELEMENT_SIZE.container;
}

function pickHandles(
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  tx: number,
  ty: number,
  tw: number,
  th: number,
): { sourceHandle: string; targetHandle: string; sourcePosition: Position; targetPosition: Position } {
  const dx = tx + tw / 2 - (sx + sw / 2);
  const dy = ty + th / 2 - (sy + sh / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? {
          sourceHandle: "right",
          targetHandle: "left",
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        }
      : {
          sourceHandle: "left-src",
          targetHandle: "right-tgt",
          sourcePosition: Position.Left,
          targetPosition: Position.Right,
        };
  }
  return dy >= 0
    ? {
        sourceHandle: "bottom",
        targetHandle: "top",
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      }
    : {
        sourceHandle: "top-src",
        targetHandle: "bottom-tgt",
        sourcePosition: Position.Top,
        targetPosition: Position.Bottom,
      };
}

// ── Public entry ──────────────────────────────────────────────────────

export function buildArchitectureFlow(diagram: ArchitectureDiagram): GraphFlowResult {
  if (diagram.kind === "deployment") return layoutDeployment(diagram);
  return layoutC4OrErd(diagram);
}

// ── C4 / ERD layout ────────────────────────────────────────────────────

/** Bucket an element into a column. ERDs use a flat 3-wide grid; C4
 *  diagrams use persons-left / focal-centre / externals-right. */
function columnFor(diagram: ArchitectureDiagram, element: ArchitectureElement, indexInGrid: number): number {
  if (diagram.kind === "erd") return indexInGrid % 3;
  if (element.kind === "person") return 0;
  if (element.kind === "external-system") return 2;
  return 1; // system / container / component
}

function layoutC4OrErd(diagram: ArchitectureDiagram): GraphFlowResult {
  const isErd = diagram.kind === "erd";

  // Column assignment.
  const colOf = new Map<string, number>();
  diagram.elements.forEach((e, i) => {
    colOf.set(e.id, columnFor(diagram, e, i));
  });

  // Row assignment within each column.
  const rowOf = new Map<string, number>();
  const perCol = new Map<number, string[]>();
  for (const e of diagram.elements) {
    const c = colOf.get(e.id) ?? 1;
    const arr = perCol.get(c) ?? [];
    arr.push(e.id);
    perCol.set(c, arr);
  }
  for (const [, ids] of perCol) {
    ids.forEach((id, idx) => {
      rowOf.set(id, idx);
    });
  }

  // Compute positions.
  const rowH = isErd ? ENTITY_ROW_HEIGHT : ROW_HEIGHT;
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const e of diagram.elements) {
    const c = colOf.get(e.id) ?? 1;
    const r = rowOf.get(e.id) ?? 0;
    const size = elementSize(e.kind, e.fields?.length ?? 0);
    pos.set(e.id, {
      x: LEFT_PADDING + c * COL_WIDTH,
      y: TOP_PADDING + r * rowH,
      w: size.width,
      h: size.height,
    });
  }

  // Compute bounds.
  let maxX = 0;
  let maxY = 0;
  for (const p of pos.values()) {
    if (p.x + p.w > maxX) maxX = p.x + p.w;
    if (p.y + p.h > maxY) maxY = p.y + p.h;
  }
  const totalWidth = maxX + LEFT_PADDING;
  const totalHeight = maxY + TOP_PADDING;

  // Build group bounding boxes from element positions.
  const nodes: ArchitectureFlowNode[] = [];

  for (const g of diagram.groups) {
    // Group bounding box = union of positions of elements whose parent === g.id.
    const children = diagram.elements.filter((e) => e.parent === g.id);
    if (children.length === 0) continue;
    let gx = Infinity;
    let gy = Infinity;
    let gx2 = -Infinity;
    let gy2 = -Infinity;
    for (const c of children) {
      const p = pos.get(c.id);
      if (!p) continue;
      gx = Math.min(gx, p.x);
      gy = Math.min(gy, p.y);
      gx2 = Math.max(gx2, p.x + p.w);
      gy2 = Math.max(gy2, p.y + p.h);
    }
    if (!Number.isFinite(gx)) continue;
    nodes.push({
      id: `__group__${g.id}`,
      type: "architectureGroup",
      position: { x: gx - GROUP_PADDING, y: gy - GROUP_PADDING - 18 },
      data: {
        label: g.label,
        kind: g.kind ?? "system-boundary",
        width: gx2 - gx + GROUP_PADDING * 2,
        height: gy2 - gy + GROUP_PADDING * 2 + 18,
      },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
      connectable: false,
    });
  }

  for (const e of diagram.elements) {
    const p = pos.get(e.id);
    if (!p) continue;
    nodes.push({
      id: e.id,
      type: "architectureShape",
      position: { x: p.x, y: p.y },
      data: {
        elementKind: e.kind,
        diagramKind: diagram.kind,
        label: e.label,
        technology: e.technology,
        description: e.description,
        stereotype: e.stereotype,
        fields: e.fields,
        inferred: e.inferred ?? false,
        width: p.w,
        height: p.h,
      },
      draggable: true,
      zIndex: 10,
    });
  }

  const edges: Edge<ArchitectureRelationEdgeData>[] = [];
  for (const r of diagram.relations) {
    const s = pos.get(r.source);
    const t = pos.get(r.target);
    if (!s || !t) continue;
    const h = pickHandles(s.x, s.y, s.w, s.h, t.x, t.y, t.w, t.h);
    edges.push({
      id: r.id,
      source: r.source,
      target: r.target,
      sourceHandle: h.sourceHandle,
      targetHandle: h.targetHandle,
      type: "architectureRelation",
      data: {
        label: r.label,
        technology: r.technology,
        kind: r.kind,
        inferred: r.inferred ?? false,
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#1e293b" },
    });
  }

  return { nodes, edges, width: totalWidth, height: totalHeight };
}

// ── Deployment layout (nested rectangles) ──────────────────────────────

interface NestedNode {
  element: ArchitectureElement;
  children: NestedNode[];
  x: number;
  y: number;
  w: number;
  h: number;
}

function layoutDeployment(diagram: ArchitectureDiagram): GraphFlowResult {
  // Build a tree from `parent` references. Roots are elements with no parent
  // or whose parent doesn't resolve to another element.
  const elementIds = new Set(diagram.elements.map((e) => e.id));
  const byId = new Map<string, NestedNode>();
  for (const e of diagram.elements) {
    byId.set(e.id, { element: e, children: [], x: 0, y: 0, w: 0, h: 0 });
  }
  const roots: NestedNode[] = [];
  for (const e of diagram.elements) {
    const node = byId.get(e.id);
    if (!node) continue;
    if (e.parent && elementIds.has(e.parent) && e.parent !== e.id) {
      byId.get(e.parent)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Pack each subtree: leaves get a fixed size; parents wrap their children
  // in a padded box. Children stack vertically.
  const PAD = 24;
  const HEADER_H = 36;
  const GAP = 14;
  const MIN_W = 220;

  function pack(n: NestedNode): void {
    if (n.children.length === 0) {
      const s = elementSize(n.element.kind);
      n.w = Math.max(MIN_W, s.width);
      n.h = s.height;
      return;
    }
    let h = HEADER_H + PAD;
    let w = MIN_W;
    for (const c of n.children) {
      pack(c);
      w = Math.max(w, c.w + PAD * 2);
    }
    for (const c of n.children) {
      c.x = PAD;
      c.y = h;
      h += c.h + GAP;
    }
    h += PAD - GAP;
    // Now widen every child to match the parent's content width so they
    // form a tidy column.
    const childW = w - PAD * 2;
    for (const c of n.children) {
      c.w = childW;
    }
    n.w = w;
    n.h = h;
  }

  // Recursive absolute positioning.
  function place(n: NestedNode, ox: number, oy: number): void {
    n.x = ox;
    n.y = oy;
    for (const c of n.children) {
      place(c, ox + c.x, oy + c.y);
    }
  }

  let cursorX = LEFT_PADDING;
  let maxY = 0;
  for (const root of roots) {
    pack(root);
    place(root, cursorX, TOP_PADDING);
    cursorX += root.w + 40;
    maxY = Math.max(maxY, TOP_PADDING + root.h);
  }

  // Emit React Flow nodes. Each non-leaf is a group; each leaf is a shape.
  // For simplicity we treat deployment-nodes that have children as groups,
  // and everything else (containers, external systems) as shapes.
  const nodes: ArchitectureFlowNode[] = [];
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();

  function emit(n: NestedNode): void {
    pos.set(n.element.id, { x: n.x, y: n.y, w: n.w, h: n.h });
    if (n.children.length > 0) {
      nodes.push({
        id: `__group__${n.element.id}`,
        type: "architectureGroup",
        position: { x: n.x, y: n.y },
        data: {
          label: n.element.label,
          kind: "deployment-group",
          technology: n.element.technology,
          width: n.w,
          height: n.h,
          inferred: n.element.inferred ?? false,
        },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -1,
        connectable: false,
      });
      for (const c of n.children) emit(c);
    } else {
      const elementWidth = n.w;
      const elementHeight = n.h;
      nodes.push({
        id: n.element.id,
        type: "architectureShape",
        position: { x: n.x, y: n.y },
        data: {
          elementKind: n.element.kind,
          diagramKind: "deployment",
          label: n.element.label,
          technology: n.element.technology,
          description: n.element.description,
          stereotype: n.element.stereotype,
          fields: n.element.fields,
          inferred: n.element.inferred ?? false,
          width: elementWidth,
          height: elementHeight,
        },
        draggable: true,
        zIndex: 10,
      });
    }
  }
  for (const root of roots) emit(root);

  // Relations: position by leaf positions (we only emit edges between
  // shape leaves; relations involving group containers are dropped).
  const edges: Edge<ArchitectureRelationEdgeData>[] = [];
  for (const r of diagram.relations) {
    const s = pos.get(r.source);
    const t = pos.get(r.target);
    if (!s || !t) continue;
    const h = pickHandles(s.x, s.y, s.w, s.h, t.x, t.y, t.w, t.h);
    edges.push({
      id: r.id,
      source: r.source,
      target: r.target,
      sourceHandle: h.sourceHandle,
      targetHandle: h.targetHandle,
      type: "architectureRelation",
      data: {
        label: r.label,
        technology: r.technology,
        kind: r.kind,
        inferred: r.inferred ?? false,
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#1e293b" },
    });
  }

  return {
    nodes,
    edges,
    width: cursorX + LEFT_PADDING,
    height: maxY + TOP_PADDING,
  };
}

// ── Sequence-diagram precheck (used by viewer) ─────────────────────────

/** Return true if the diagram should be rendered with the dedicated SVG sequence canvas. */
export function isSequenceDiagram(d: ArchitectureDiagram): boolean {
  return d.kind === "sequence";
}
