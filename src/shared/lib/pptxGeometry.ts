import { boolAttr, child, childList, EMU_PER_PX } from "./ooxml";

/** DrawingML path coordinates are mapped to the shape's CSS pixel rectangle. */
export interface PptxShapePath {
  d: string;
  fill: string;
  stroke: boolean;
}

const FULL_TURN = 21_600_000;
const TO_RAD = (2 * Math.PI) / FULL_TURN;
type Guides = Map<string, number>;
type Point = [number, number];

function resolve(value: string | null | undefined, guides: Guides): number {
  if (!value?.trim()) return NaN;
  return guides.get(value) ?? Number(value);
}

// ECMA-376 §20.1.9.11: ordered guide formulas, never executable expressions.
function formula(value: string, guides: Guides): number {
  const [op, ...tokens] = value.trim().split(/\s+/);
  const [x = NaN, y = NaN, z = NaN] = tokens.map((token) => resolve(token, guides));
  switch (op) {
    case "val":
      return x;
    case "*/":
      return (x * y) / z;
    case "+-":
      return x + y - z;
    case "+/":
      return (x + y) / z;
    case "?:":
      return x > 0 ? y : z;
    case "abs":
      return Math.abs(x);
    case "at2":
      return Math.atan2(y, x) / TO_RAD;
    case "cat2":
      return x * Math.cos(Math.atan2(z, y));
    case "sat2":
      return x * Math.sin(Math.atan2(z, y));
    case "cos":
      return x * Math.cos(y * TO_RAD);
    case "sin":
      return x * Math.sin(y * TO_RAD);
    case "tan":
      return x * Math.tan(y * TO_RAD);
    case "max":
      return Math.max(x, y);
    case "min":
      return Math.min(x, y);
    case "mod":
      return Math.hypot(x, y, z);
    case "pin":
      return Math.max(x, Math.min(y, z));
    case "sqrt":
      return Math.sqrt(x);
    default:
      return NaN;
  }
}

function guideValues(geometry: Element, w: number, h: number): Guides {
  const guides: Guides = new Map(
    Object.entries({
      w,
      h,
      l: 0,
      t: 0,
      r: w,
      b: h,
      hc: w / 2,
      vc: h / 2,
      ss: Math.min(w, h),
      ls: Math.max(w, h),
      cd: FULL_TURN,
    }),
  );
  for (const [prefix, size] of [
    ["wd", w],
    ["hd", h],
    ["ssd", Math.min(w, h)],
  ] as const) {
    for (const divisor of [2, 3, 4, 5, 6, 8, 10, 12, 16, 32]) guides.set(`${prefix}${divisor}`, size / divisor);
  }
  for (const divisor of [2, 4, 8]) guides.set(`cd${divisor}`, FULL_TURN / divisor);
  for (const numerator of [3, 5, 7]) guides.set(`${numerator}cd8`, (numerator * FULL_TURN) / 8);
  guides.set("3cd4", (3 * FULL_TURN) / 4);
  for (const list of ["a:avLst", "a:gdLst"]) {
    for (const gd of childList(child(geometry, list), "a:gd")) {
      const name = gd.getAttribute("name");
      const value = formula(gd.getAttribute("fmla") ?? "", guides);
      if (name && Number.isFinite(value)) guides.set(name, value);
    }
  }
  return guides;
}

function n(value: number): string {
  return String(Math.round(value * 100_000) / 100_000);
}

/** DrawingML angles are radial angles; SVG ellipse endpoints use parametric angles. */
function ellipsePoint(rx: number, ry: number, angle: number): Point {
  const theta = angle * TO_RAD;
  const param = Math.atan2(rx * Math.sin(theta), ry * Math.cos(theta));
  return [rx * Math.cos(param), ry * Math.sin(param)];
}

function arcTo(pen: Point, rx: number, ry: number, start: number, sweep: number, sx: number, sy: number) {
  if (![rx, ry, start, sweep].every(Number.isFinite)) return undefined;
  if (rx <= 0 || ry <= 0 || sweep === 0) return { d: "", end: pen };
  // At most one revolution is visible. Splitting at half turns also makes a
  // full circle representable in SVG (a single coincident-endpoint arc vanishes).
  sweep = Math.max(-FULL_TURN, Math.min(FULL_TURN, sweep));
  const [dx, dy] = ellipsePoint(rx, ry, start);
  const center: Point = [pen[0] - dx, pen[1] - dy];
  const segments = Math.ceil(Math.abs(sweep) / (FULL_TURN / 2));
  let end = pen;
  const commands: string[] = [];
  for (let i = 1; i <= segments; i++) {
    const offset = ellipsePoint(rx, ry, start + (sweep * i) / segments);
    end = [center[0] + offset[0], center[1] + offset[1]];
    commands.push(`A ${n(rx * sx)} ${n(ry * sy)} 0 0 ${sweep > 0 ? 1 : 0} ${n(end[0] * sx)} ${n(end[1] * sy)}`);
  }
  return { d: commands.join(" "), end };
}

function customPath(path: Element, guides: Guides, w: number, h: number): PptxShapePath | undefined {
  const pathW = Number(path.getAttribute("w")) || guides.get("w") || 1;
  const pathH = Number(path.getAttribute("h")) || guides.get("h") || 1;
  if (![pathW, pathH].every((value) => Number.isFinite(value) && value > 0)) return undefined;
  const sx = w / pathW;
  const sy = h / pathH;
  const commands: string[] = [];
  let pen: Point = [0, 0];
  let subpathStart = pen;
  for (const command of path.children) {
    const pts = childList(command, "a:pt").map((pt): Point => [
      resolve(pt.getAttribute("x"), guides),
      resolve(pt.getAttribute("y"), guides),
    ]);
    if (pts.some((pt) => !pt.every(Number.isFinite))) return undefined;
    const pointText = (count: number) =>
      pts
        .slice(0, count)
        .map(([x, y]) => `${n(x * sx)} ${n(y * sy)}`)
        .join(" ");
    switch (command.tagName) {
      case "a:moveTo":
      case "a:lnTo":
        if (!pts[0]) return undefined;
        commands.push(`${command.tagName === "a:moveTo" ? "M" : "L"} ${pointText(1)}`);
        pen = pts[0];
        if (command.tagName === "a:moveTo") subpathStart = pen;
        break;
      case "a:cubicBezTo":
      case "a:quadBezTo": {
        const count = command.tagName === "a:cubicBezTo" ? 3 : 2;
        if (pts.length < count) return undefined;
        commands.push(`${count === 3 ? "C" : "Q"} ${pointText(count)}`);
        pen = pts[count - 1];
        break;
      }
      case "a:arcTo": {
        const arc = arcTo(
          pen,
          resolve(command.getAttribute("wR"), guides),
          resolve(command.getAttribute("hR"), guides),
          resolve(command.getAttribute("stAng"), guides),
          resolve(command.getAttribute("swAng"), guides),
          sx,
          sy,
        );
        if (!arc) return undefined;
        if (arc.d) commands.push(arc.d);
        pen = arc.end;
        break;
      }
      case "a:close":
        commands.push("Z");
        pen = subpathStart;
        break;
      default:
        return undefined;
    }
  }
  const d = commands.join(" ");
  if (!d || /NaN|Infinity/.test(d)) return undefined;
  return { d, fill: path.getAttribute("fill") ?? "norm", stroke: boolAttr(path, "stroke") ?? true };
}

/** ECMA-376 §20.1.9: preserve each path's coordinate space, winding and paint. */
export function pptxShapePaths(spPr: Element | undefined, w: number, h: number): PptxShapePath[] | undefined {
  const custom = child(spPr, "a:custGeom");
  if (custom) {
    // Built-in guides use shape EMUs, independently of each path's w/h.
    const guides = guideValues(custom, w * EMU_PER_PX, h * EMU_PER_PX);
    return childList(child(custom, "a:pathLst"), "a:path").flatMap((path) => {
      const parsed = customPath(path, guides, w, h);
      return parsed ? [parsed] : [];
    });
  }
  const preset = child(spPr, "a:prstGeom");
  const name = preset?.getAttribute("prst");
  if (!preset || (name !== "arc" && name !== "blockArc")) return undefined;
  const guides = guideValues(preset, w, h);
  const start = Math.max(
    0,
    Math.min(FULL_TURN - 1, guides.get("adj1") ?? (name === "blockArc" ? 10_800_000 : 16_200_000)),
  );
  const end = Math.max(0, Math.min(FULL_TURN - 1, guides.get("adj2") ?? 0));
  const sweep = end > start ? end - start : end - start + FULL_TURN;
  const [dx, dy] = ellipsePoint(w / 2, h / 2, start);
  const pen: Point = [w / 2 + dx, h / 2 + dy];
  const arc = arcTo(pen, w / 2, h / 2, start, sweep, 1, 1);
  if (!arc) return [];
  const d = `M ${n(pen[0])} ${n(pen[1])} ${arc.d}`;
  if (name === "blockArc") {
    // The blockArc preset is an annular sector. Its thickness adjustment is
    // a fraction of the shorter shape dimension, capped at half that side.
    const thickness = (Math.min(w, h) * Math.max(0, Math.min(50_000, guides.get("adj3") ?? 25_000))) / 100_000;
    const rx = w / 2 - thickness;
    const ry = h / 2 - thickness;
    const [ix, iy] = ellipsePoint(rx, ry, end);
    const innerPen: Point = [w / 2 + ix, h / 2 + iy];
    const inner = arcTo(innerPen, rx, ry, end, -sweep, 1, 1);
    return [{ d: `${d} L ${n(innerPen[0])} ${n(innerPen[1])} ${inner?.d ?? ""} Z`, fill: "norm", stroke: true }];
  }
  // The arc preset has a closed, unstroked pie fill and an open, unfilled
  // outline. Closing the outline incorrectly draws radial lines across it.
  return [
    { d: `${d} L ${n(w / 2)} ${n(h / 2)} Z`, fill: "norm", stroke: false },
    { d, fill: "none", stroke: true },
  ];
}
