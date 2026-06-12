import JSZip from "jszip";
import {
  boolAttr,
  child,
  childList,
  cssFontStack,
  descend,
  emuToPx,
  escapeHtml,
  getRId,
  intAttr,
  loadMediaDataUrl,
  mapBulletChar,
  type OoxmlTheme,
  parseRels,
  parseThemeDoc,
  parseXml,
  ptToPx,
  px,
  type Rel,
  relsPathFor,
  resolveTarget,
  toAlpha,
  toRoman,
} from "./ooxml";
import { type FillResolver, parseChart, renderChartSvg } from "./ooxmlChart";
import { getSlideOrder } from "./pptx";

/**
 * Converts a PPTX file to an array of self-contained HTML slide documents
 * with high layout fidelity: absolute shape positioning, theme colors and
 * fonts, master/layout inheritance (backgrounds, placeholders, decorative
 * shapes), rich text formatting, images, tables, gradients and groups.
 *
 * Each slide is a complete HTML document sized to the deck's slide
 * dimensions (in CSS px at 96 dpi) — render it in an iframe and scale to
 * fit, like the notebook slide viewer does.
 */

export interface PptxHtmlResult {
  /** Slide width in CSS px */
  width: number;
  /** Slide height in CSS px */
  height: number;
  /** One self-contained HTML document per slide, in presentation order */
  slides: string[];
}

export async function pptxToHtml(file: File): Promise<PptxHtmlResult> {
  const zip = await JSZip.loadAsync(file);

  const slidePaths = await getSlideOrder(zip);
  if (slidePaths.length === 0) {
    throw new Error("Invalid PPTX: no slides found");
  }

  // Slide dimensions from presentation.xml
  const presXml = await zip.file("ppt/presentation.xml")?.async("string");
  if (!presXml) {
    throw new Error("Invalid PPTX: missing presentation.xml");
  }
  const presDoc = parseXml(presXml);
  const sldSz = presDoc.getElementsByTagName("p:sldSz")[0];
  const width = emuToPx(parseInt(sldSz?.getAttribute("cx") || "12192000", 10));
  const height = emuToPx(parseInt(sldSz?.getAttribute("cy") || "6858000", 10));

  const shared: SharedCtx = {
    zip,
    mediaCache: new Map(),
    themeCache: new Map(),
    xmlCache: new Map(),
    relsCache: new Map(),
    tableStyles: await loadTableStyles(zip),
  };

  const slides: string[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    slides.push(await renderSlideDocument(shared, slidePaths[i], i + 1, width, height));
  }

  return { width, height, slides };
}

// ============================================================================
// Shared context & part loading
// ============================================================================

type Rels = Map<string, Rel>;

interface Theme extends OoxmlTheme {
  fillStyles: Element[];
  lineStyles: Element[];
  bgFillStyles: Element[];
}

interface SharedCtx {
  zip: JSZip;
  /** part path → data URL */
  mediaCache: Map<string, string>;
  themeCache: Map<string, Theme>;
  xmlCache: Map<string, Document | null>;
  relsCache: Map<string, Rels>;
  tableStyles: Map<string, Element>;
}

/** Per-part (slide / layout / master) rendering context */
interface PartCtx {
  path: string;
  rels: Rels;
}

interface SlideCtx {
  shared: SharedCtx;
  theme: Theme;
  /** bg1/tx1/bg2/tx2 → theme slot from the master's clrMap */
  clrMap: Record<string, string>;
  slide: PartCtx;
  layout: PartCtx;
  master: PartCtx;
  layoutDoc: Document | null;
  masterDoc: Document | null;
  slideNum: number;
}

async function loadXml(shared: SharedCtx, path: string): Promise<Document | null> {
  if (shared.xmlCache.has(path)) return shared.xmlCache.get(path) ?? null;
  const content = await shared.zip.file(path)?.async("string");
  const doc = content ? parseXml(content) : null;
  shared.xmlCache.set(path, doc);
  return doc;
}

async function loadRels(shared: SharedCtx, partPath: string): Promise<Rels> {
  const cached = shared.relsCache.get(partPath);
  if (cached) return cached;
  const rels = parseRels(await loadXml(shared, relsPathFor(partPath)));
  shared.relsCache.set(partPath, rels);
  return rels;
}

function findRelByType(rels: Rels, typeSuffix: string): Rel | undefined {
  for (const rel of rels.values()) {
    if (rel.type.endsWith(typeSuffix)) return rel;
  }
  return undefined;
}

async function loadMedia(shared: SharedCtx, path: string): Promise<string | undefined> {
  return loadMediaDataUrl(shared.zip, shared.mediaCache, path);
}

// ============================================================================
// Theme parsing
// ============================================================================

async function loadTheme(shared: SharedCtx, themePath: string): Promise<Theme> {
  const cached = shared.themeCache.get(themePath);
  if (cached) return cached;

  const doc = await loadXml(shared, themePath);
  const fmtScheme = doc?.getElementsByTagName("a:fmtScheme")[0];
  const theme: Theme = {
    ...parseThemeDoc(doc),
    fillStyles: childList(child(fmtScheme, "a:fillStyleLst")),
    lineStyles: childList(child(fmtScheme, "a:lnStyleLst")),
    bgFillStyles: childList(child(fmtScheme, "a:bgFillStyleLst")),
  };

  shared.themeCache.set(themePath, theme);
  return theme;
}

async function loadTableStyles(zip: JSZip): Promise<Map<string, Element>> {
  const styles = new Map<string, Element>();
  const xml = await zip.file("ppt/tableStyles.xml")?.async("string");
  if (!xml) return styles;
  const doc = parseXml(xml);
  for (const style of doc.getElementsByTagName("a:tblStyle")) {
    const id = style.getAttribute("styleId");
    if (id) styles.set(id, style);
  }
  return styles;
}

// ============================================================================
// Color resolution
// ============================================================================

interface ColorEnv {
  theme: Theme;
  clrMap: Record<string, string>;
  /** Resolved "placeholder color" for theme style references */
  phClr?: string;
}

const PRESET_COLORS: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  cyan: "00FFFF",
  magenta: "FF00FF",
  gray: "808080",
  grey: "808080",
  ltGray: "C0C0C0",
  dkGray: "404040",
  orange: "FFA500",
  purple: "800080",
};

/**
 * Resolve a DrawingML color element (a:srgbClr, a:schemeClr, a:sysClr,
 * a:prstClr, a:scrgbClr) plus its child transforms to a CSS color string.
 */
function resolveColor(colorEl: Element | undefined, env: ColorEnv): string | undefined {
  if (!colorEl) return undefined;

  let hex: string | undefined;
  const tag = colorEl.tagName;

  if (tag === "a:srgbClr") {
    hex = colorEl.getAttribute("val") ?? undefined;
  } else if (tag === "a:sysClr") {
    hex = colorEl.getAttribute("lastClr") ?? undefined;
    if (!hex) hex = colorEl.getAttribute("val") === "window" ? "FFFFFF" : "000000";
  } else if (tag === "a:schemeClr") {
    const val = colorEl.getAttribute("val") || "";
    if (val === "phClr") {
      hex = env.phClr ? cssToHex(env.phClr) : undefined;
    } else {
      const slot = env.clrMap[val] || val;
      hex = env.theme.colors[slot];
    }
  } else if (tag === "a:prstClr") {
    const val = colorEl.getAttribute("val") || "";
    hex = PRESET_COLORS[val];
  } else if (tag === "a:scrgbClr") {
    const r = (intAttr(colorEl, "r") ?? 0) / 100000;
    const g = (intAttr(colorEl, "g") ?? 0) / 100000;
    const b = (intAttr(colorEl, "b") ?? 0) / 100000;
    hex = rgbToHex([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]);
  }

  if (!hex) return undefined;

  let rgb = hexToRgb(hex);
  let alpha = 1;

  for (const mod of colorEl.children) {
    const val = intAttr(mod, "val");
    if (val == null) continue;
    const f = val / 100000;
    switch (mod.tagName) {
      case "a:alpha":
        alpha = f;
        break;
      case "a:tint":
        rgb = rgb.map((c) => c * f + 255 * (1 - f)) as Rgb;
        break;
      case "a:shade":
        rgb = rgb.map((c) => c * f) as Rgb;
        break;
      case "a:lumMod":
        rgb = adjustLuminance(rgb, f, 0);
        break;
      case "a:lumOff":
        rgb = adjustLuminance(rgb, 1, f);
        break;
      case "a:satMod":
        rgb = adjustSaturation(rgb, f);
        break;
    }
  }

  const clamped = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c)))) as Rgb;
  if (alpha >= 1) return `#${rgbToHex(clamped)}`;
  return `rgba(${clamped[0]},${clamped[1]},${clamped[2]},${Math.round(alpha * 1000) / 1000})`;
}

/** Find the first color element inside a container (e.g. a:solidFill) and resolve it. */
function resolveColorIn(container: Element | undefined, env: ColorEnv): string | undefined {
  if (!container) return undefined;
  for (const c of container.children) {
    if (c.tagName.endsWith("Clr")) {
      const color = resolveColor(c, env);
      if (color) return color;
    }
  }
  return undefined;
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "").padEnd(6, "0");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(rgb: Rgb): string {
  return rgb
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();
}

function cssToHex(css: string): string | undefined {
  const m = css.match(/^#([0-9a-fA-F]{6})/);
  return m ? m[1] : undefined;
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

function adjustLuminance(rgb: Rgb, mod: number, off: number): Rgb {
  const hsl = rgbToHsl(rgb);
  hsl[2] = Math.max(0, Math.min(1, hsl[2] * mod + off));
  return hslToRgb(hsl);
}

function adjustSaturation(rgb: Rgb, mod: number): Rgb {
  const hsl = rgbToHsl(rgb);
  hsl[1] = Math.max(0, Math.min(1, hsl[1] * mod));
  return hslToRgb(hsl);
}

// ============================================================================
// Fill rendering
// ============================================================================

/**
 * Convert a fill element (a:solidFill, a:gradFill, a:blipFill, a:pattFill,
 * a:noFill, a:grpFill) to a CSS `background` value.
 */
async function fillToCss(
  fill: Element | undefined,
  env: ColorEnv,
  ctx: SlideCtx,
  part: PartCtx,
): Promise<string | undefined> {
  if (!fill) return undefined;

  switch (fill.tagName) {
    case "a:noFill":
      return "transparent";
    case "a:solidFill":
      return resolveColorIn(fill, env);
    case "a:gradFill": {
      const stops: { pos: number; color: string }[] = [];
      for (const gs of childList(child(fill, "a:gsLst"), "a:gs")) {
        const pos = (intAttr(gs, "pos") ?? 0) / 1000;
        const color = resolveColorIn(gs, env);
        if (color) stops.push({ pos, color });
      }
      if (stops.length === 0) return undefined;
      stops.sort((a, b) => a.pos - b.pos);
      const stopCss = stops.map((s) => `${s.color} ${Math.round(s.pos * 100) / 100}%`).join(", ");
      const lin = child(fill, "a:lin");
      if (lin) {
        // DrawingML angle: 0 = east, clockwise; CSS: 0 = north, clockwise
        const ang = (intAttr(lin, "ang") ?? 0) / 60000;
        return `linear-gradient(${Math.round((ang + 90) % 360)}deg, ${stopCss})`;
      }
      if (child(fill, "a:path")) {
        return `radial-gradient(circle, ${stopCss})`;
      }
      return `linear-gradient(90deg, ${stopCss})`;
    }
    case "a:blipFill": {
      const rId = getRId(child(fill, "a:blip"));
      const rel = rId ? part.rels.get(rId) : undefined;
      if (!rel || rel.external) return undefined;
      const url = await loadMedia(ctx.shared, resolveTarget(part.path, rel.target));
      if (!url) return undefined;
      const tiled = !!child(fill, "a:tile");
      return tiled ? `url('${url}') repeat` : `url('${url}') center / cover no-repeat`;
    }
    case "a:pattFill": {
      // Approximate pattern fills with the foreground color
      return resolveColorIn(child(fill, "a:fgClr"), env) ?? resolveColorIn(child(fill, "a:bgClr"), env);
    }
    default:
      return undefined;
  }
}

function findFillElement(container: Element | undefined): Element | undefined {
  if (!container) return undefined;
  for (const c of container.children) {
    if (["a:solidFill", "a:gradFill", "a:blipFill", "a:pattFill", "a:noFill", "a:grpFill"].includes(c.tagName)) {
      return c;
    }
  }
  return undefined;
}

/** Resolve a theme style reference (fillRef / lnRef / bgRef) to a fill element + phClr. */
function resolveStyleRef(
  ref: Element | undefined,
  styles: Element[],
  bgStyles: Element[],
  env: ColorEnv,
): { fill: Element; phClr?: string } | undefined {
  if (!ref) return undefined;
  const idx = intAttr(ref, "idx") ?? 0;
  if (idx === 0) return undefined;
  const phClr = resolveColorIn(ref, env);
  const list = idx >= 1001 ? bgStyles : styles;
  const i = idx >= 1001 ? idx - 1001 : idx - 1;
  const fill = list[Math.min(i, list.length - 1)];
  if (!fill) return undefined;
  return { fill, phClr: phClr ? (cssToHex(phClr) ?? phClr) : undefined };
}

// ============================================================================
// Line (border) rendering
// ============================================================================

interface LineStyle {
  widthPx: number;
  color: string;
  dash: string; // CSS border-style
}

function lineToStyle(ln: Element | undefined, env: ColorEnv): LineStyle | undefined {
  if (!ln) return undefined;
  if (child(ln, "a:noFill")) return undefined;
  const color = resolveColorIn(child(ln, "a:solidFill"), env) ?? resolveColorIn(child(ln, "a:gradFill"), env);
  if (!color) return undefined;
  const w = intAttr(ln, "w") ?? 9525;
  const prstDash = child(ln, "a:prstDash")?.getAttribute("val") || "solid";
  const dash = prstDash.includes("dash") ? "dashed" : prstDash.includes("dot") ? "dotted" : "solid";
  return { widthPx: Math.max(emuToPx(w), 0.5), color, dash };
}

// ============================================================================
// Slide rendering
// ============================================================================

async function renderSlideDocument(
  shared: SharedCtx,
  slidePath: string,
  slideNum: number,
  width: number,
  height: number,
): Promise<string> {
  const slideDoc = await loadXml(shared, slidePath);
  const slideRels = await loadRels(shared, slidePath);

  // Resolve layout & master parts
  const layoutRel = findRelByType(slideRels, "/slideLayout");
  const layoutPath = layoutRel ? resolveTarget(slidePath, layoutRel.target) : "";
  const layoutDoc = layoutPath ? await loadXml(shared, layoutPath) : null;
  const layoutRels = layoutPath ? await loadRels(shared, layoutPath) : new Map<string, Rel>();

  const masterRel = findRelByType(layoutRels, "/slideMaster");
  const masterPath = masterRel ? resolveTarget(layoutPath, masterRel.target) : "";
  const masterDoc = masterPath ? await loadXml(shared, masterPath) : null;
  const masterRels = masterPath ? await loadRels(shared, masterPath) : new Map<string, Rel>();

  const themeRel = findRelByType(masterRels, "/theme");
  const themePath = themeRel ? resolveTarget(masterPath, themeRel.target) : "ppt/theme/theme1.xml";
  const theme = await loadTheme(shared, themePath);

  // Color map from the master (bg1 → lt1 etc.)
  const clrMap: Record<string, string> = {};
  const clrMapEl = masterDoc?.getElementsByTagName("p:clrMap")[0];
  if (clrMapEl) {
    for (const attr of clrMapEl.attributes) {
      clrMap[attr.name] = attr.value;
    }
  }
  // bg1/tx1 style aliases used by schemeClr
  clrMap.bg1 = clrMap.bg1 || "lt1";
  clrMap.tx1 = clrMap.tx1 || "dk1";
  clrMap.bg2 = clrMap.bg2 || "lt2";
  clrMap.tx2 = clrMap.tx2 || "dk2";

  const ctx: SlideCtx = {
    shared,
    theme,
    clrMap,
    slide: { path: slidePath, rels: slideRels },
    layout: { path: layoutPath, rels: layoutRels },
    master: { path: masterPath, rels: masterRels },
    layoutDoc,
    masterDoc,
    slideNum,
  };

  const env: ColorEnv = { theme, clrMap };

  // --- Background: slide → layout → master ---
  let bgCss = "#FFFFFF";
  for (const [doc, part] of [
    [slideDoc, ctx.slide],
    [layoutDoc, ctx.layout],
    [masterDoc, ctx.master],
  ] as const) {
    if (!doc) continue;
    const bg = descend(doc.documentElement, "p:cSld", "p:bg");
    if (!bg) continue;
    const bgPr = child(bg, "p:bgPr");
    if (bgPr) {
      const css = await fillToCss(findFillElement(bgPr), env, ctx, part);
      if (css) bgCss = css;
      break;
    }
    const bgRef = child(bg, "p:bgRef");
    if (bgRef) {
      const ref = resolveStyleRef(bgRef, theme.fillStyles, theme.bgFillStyles, env);
      if (ref) {
        const css = await fillToCss(ref.fill, { ...env, phClr: ref.phClr ? `#${ref.phClr}` : undefined }, ctx, part);
        if (css) bgCss = css;
      } else {
        const color = resolveColorIn(bgRef, env);
        if (color) bgCss = color;
      }
      break;
    }
  }

  // --- Shape layers: master (non-placeholder) → layout (non-placeholder) → slide ---
  const parts: string[] = [];

  // "Hide background graphics" on the slide suppresses master AND layout
  // decoration; the layout's own flag suppresses just the master's.
  const slideShowsBg = slideDoc?.documentElement.getAttribute("showMasterSp") !== "0";
  const layoutShowsMaster = layoutDoc?.documentElement.getAttribute("showMasterSp") !== "0";
  if (masterDoc && slideShowsBg && layoutShowsMaster) {
    const tree = descend(masterDoc.documentElement, "p:cSld", "p:spTree");
    if (tree) parts.push(await renderShapeTree(tree, ctx.master, ctx, { skipPlaceholders: true }));
  }
  if (layoutDoc && slideShowsBg) {
    const tree = descend(layoutDoc.documentElement, "p:cSld", "p:spTree");
    if (tree) parts.push(await renderShapeTree(tree, ctx.layout, ctx, { skipPlaceholders: true }));
  }
  if (slideDoc) {
    const tree = descend(slideDoc.documentElement, "p:cSld", "p:spTree");
    if (tree) parts.push(await renderShapeTree(tree, ctx.slide, ctx, {}));
  }

  const tx1Slot = clrMap.tx1 || "dk1";
  const textColor = theme.colors[tx1Slot] ? `#${theme.colors[tx1Slot]}` : "#000000";

  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><style>',
    "*{margin:0;padding:0;box-sizing:border-box;}",
    `html,body{width:${px(width)};height:${px(height)};overflow:hidden;}`,
    `body{position:relative;font-family:${cssFontStack(theme.minorFont)};color:${textColor};` +
      `background:${bgCss};background-size:cover;-webkit-font-smoothing:antialiased;}`,
    "a{color:inherit;text-decoration:underline;}",
    "table{border-collapse:collapse;table-layout:fixed;}",
    "</style></head><body>",
    ...parts,
    `<script>${AUTOFIT_SCRIPT}</script>`,
    "</body></html>",
  ].join("");
}

/**
 * In-document autofit: shrinks the font sizes inside [data-autofit] text
 * bodies until the content fits its shape, mirroring PowerPoint's
 * "Shrink text on overflow". Runs once at parse time and again when fonts
 * finish loading (metrics change). Idempotent — original sizes are kept in
 * data attributes.
 */

/** Declared normAutofit shrinks down to PowerPoint's floor. */
const AUTOFIT_NORM_FLOOR = 0.25;
/** Soft (undeclared) autofit keeps text readable: higher floor… */
const AUTOFIT_SOFT_FLOOR = 0.4;
/** …and only intervenes when content overflows the shape by >25%. */
const AUTOFIT_SOFT_TRIGGER = 1.25;

const AUTOFIT_SCRIPT = `(function(){
var PROPS=['fontSize','lineHeight','marginTop','marginBottom','minWidth'];
function fit(el){
  var els=[el].concat([].slice.call(el.querySelectorAll('*')));
  // Snapshot the px-valued inline props that should shrink with the text
  var items=[];
  els.forEach(function(e){
    if(!e.style)return;
    PROPS.forEach(function(p){
      var v=e.style[p];
      if(v&&v.slice(-2)==='px'){
        var key='af'+p;
        if(!(key in e.dataset))e.dataset[key]=parseFloat(v);
        items.push({e:e,p:p,v:parseFloat(e.dataset[key])});
      }
    });
  });
  if(!items.length)return;
  var soft=el.dataset.autofit==='soft';
  var floor=soft?${AUTOFIT_SOFT_FLOOR}:${AUTOFIT_NORM_FLOOR};
  var prevJc=el.style.justifyContent;
  el.style.justifyContent='flex-start';
  function apply(s){items.forEach(function(it){it.e.style[it.p]=it.v*s+'px'})}
  function ok(){return el.scrollHeight<=el.clientHeight+1&&el.scrollWidth<=el.clientWidth+1}
  apply(1);
  // Soft mode only intervenes on gross overflow past the trigger ratio
  var T=${AUTOFIT_SOFT_TRIGGER};
  var trigger=soft?(el.scrollHeight>el.clientHeight*T||el.scrollWidth>el.clientWidth*T):!ok();
  if(trigger&&!ok()){
    var lo=floor,hi=1;
    for(var i=0;i<8;i++){var mid=(lo+hi)/2;apply(mid);if(ok())lo=mid;else hi=mid}
    apply(lo);
  }
  el.style.justifyContent=prevJc;
}
function run(){[].slice.call(document.querySelectorAll('[data-autofit]')).forEach(fit)}
run();
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(run);
})();`;

// ============================================================================
// Shape tree rendering
// ============================================================================

interface TreeOpts {
  skipPlaceholders?: boolean;
  /** Child-coordinate origin when rendering inside a group */
  origin?: { x: number; y: number };
}

/**
 * Shapes can be flagged hidden via p:cNvPr hidden="1" (common for template
 * machinery on masters — e.g. %FIELD% boxes an add-in fills at present time).
 * PowerPoint never paints them.
 */
function isHiddenShape(node: Element): boolean {
  for (const c of node.children) {
    if (c.tagName.startsWith("p:nv")) {
      return child(c, "p:cNvPr")?.getAttribute("hidden") === "1";
    }
  }
  return false;
}

async function renderShapeTree(spTree: Element, part: PartCtx, ctx: SlideCtx, opts: TreeOpts): Promise<string> {
  const out: string[] = [];

  for (const node of spTree.children) {
    if (isHiddenShape(node)) continue;
    switch (node.tagName) {
      case "p:sp":
        out.push(await renderShape(node, part, ctx, opts));
        break;
      case "p:pic":
        out.push(await renderPicture(node, part, ctx, opts));
        break;
      case "p:graphicFrame":
        out.push(await renderGraphicFrame(node, part, ctx, opts));
        break;
      case "p:grpSp":
        out.push(await renderGroup(node, part, ctx, opts));
        break;
      case "p:cxnSp":
        out.push(renderConnector(node, ctx, opts));
        break;
    }
  }

  return out.join("");
}

// --- Transforms ---

interface Xfrm {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number; // degrees
  flipH: boolean;
  flipV: boolean;
}

function parseXfrm(xfrm: Element | undefined): Xfrm | undefined {
  if (!xfrm) return undefined;
  const off = child(xfrm, "a:off");
  const ext = child(xfrm, "a:ext");
  if (!off || !ext) return undefined;
  return {
    x: emuToPx(intAttr(off, "x") ?? 0),
    y: emuToPx(intAttr(off, "y") ?? 0),
    w: emuToPx(intAttr(ext, "cx") ?? 0),
    h: emuToPx(intAttr(ext, "cy") ?? 0),
    rot: (intAttr(xfrm, "rot") ?? 0) / 60000,
    flipH: boolAttr(xfrm, "flipH") ?? false,
    flipV: boolAttr(xfrm, "flipV") ?? false,
  };
}

function xfrmTransform(x: Xfrm): string {
  const t: string[] = [];
  if (x.rot) t.push(`rotate(${Math.round(x.rot * 100) / 100}deg)`);
  if (x.flipH) t.push("scaleX(-1)");
  if (x.flipV) t.push("scaleY(-1)");
  return t.length ? `transform:${t.join(" ")};` : "";
}

function positionStyle(x: Xfrm, opts: TreeOpts): string {
  const ox = opts.origin?.x ?? 0;
  const oy = opts.origin?.y ?? 0;
  return `position:absolute;left:${px(x.x - ox)};top:${px(x.y - oy)};width:${px(x.w)};height:${px(x.h)};${xfrmTransform(x)}`;
}

// --- Placeholders ---

interface PhInfo {
  type: string | null;
  idx: string | null;
}

function getPhInfo(shape: Element): PhInfo | null {
  const ph =
    descend(shape, "p:nvSpPr", "p:nvPr", "p:ph") ??
    descend(shape, "p:nvPicPr", "p:nvPr", "p:ph") ??
    descend(shape, "p:nvGraphicFramePr", "p:nvPr", "p:ph");
  if (!ph) return null;
  return { type: ph.getAttribute("type"), idx: ph.getAttribute("idx") };
}

/** Find the matching placeholder shape in a layout or master document. */
function findPlaceholder(doc: Document | null, ph: PhInfo): Element | undefined {
  if (!doc) return undefined;
  const equivalentTypes = (t: string | null): string[] => {
    if (t === "title" || t === "ctrTitle") return ["title", "ctrTitle"];
    if (t === "body" || t === "subTitle") return ["body", "subTitle"];
    return t ? [t] : [];
  };

  let typeMatch: Element | undefined;
  for (const sp of doc.getElementsByTagName("p:sp")) {
    const candidate = descend(sp, "p:nvSpPr", "p:nvPr", "p:ph");
    if (!candidate) continue;
    const cIdx = candidate.getAttribute("idx");
    const cType = candidate.getAttribute("type");
    if (ph.idx != null && cIdx === ph.idx) return sp;
    if (!typeMatch && ph.type && equivalentTypes(ph.type).includes(cType || "")) typeMatch = sp;
  }
  return typeMatch;
}

// --- Geometry ---

function geometryStyle(spPr: Element | undefined, w: number, h: number): string {
  const prst = child(spPr, "a:prstGeom")?.getAttribute("prst");
  if (!prst) return "";
  if (prst === "ellipse") return "border-radius:50%;";
  if (prst === "roundRect" || prst === "round1Rect" || prst === "round2SameRect") {
    const adj = descend(child(spPr, "a:prstGeom"), "a:avLst", "a:gd");
    let frac = 16667 / 100000;
    const fmla = adj?.getAttribute("fmla");
    if (fmla?.startsWith("val ")) {
      const v = parseInt(fmla.slice(4), 10);
      if (!Number.isNaN(v)) frac = v / 100000;
    }
    return `border-radius:${px(Math.min(w, h) * frac)};`;
  }
  return "";
}

// Common preset geometries as normalized polygon silhouettes (points in a
// 0–100 box). Used to clip the shape's fill and to stroke its outline so
// arrows/chevrons/triangles/stars render with their real shape instead of a
// plain rectangle. Adjustment guides are approximated with Office defaults.
const PRESET_POLY: Record<string, [number, number][]> = {
  triangle: [
    [50, 0],
    [100, 100],
    [0, 100],
  ],
  rtTriangle: [
    [0, 0],
    [0, 100],
    [100, 100],
  ],
  diamond: [
    [50, 0],
    [100, 50],
    [50, 100],
    [0, 50],
  ],
  flowChartDecision: [
    [50, 0],
    [100, 50],
    [50, 100],
    [0, 50],
  ],
  parallelogram: [
    [25, 0],
    [100, 0],
    [75, 100],
    [0, 100],
  ],
  trapezoid: [
    [25, 0],
    [75, 0],
    [100, 100],
    [0, 100],
  ],
  pentagon: [
    [50, 0],
    [98, 38],
    [79, 100],
    [21, 100],
    [2, 38],
  ],
  hexagon: [
    [25, 0],
    [75, 0],
    [100, 50],
    [75, 100],
    [25, 100],
    [0, 50],
  ],
  heptagon: [
    [50, 0],
    [89, 21],
    [99, 61],
    [72, 99],
    [28, 99],
    [1, 61],
    [11, 21],
  ],
  octagon: [
    [30, 0],
    [70, 0],
    [100, 30],
    [100, 70],
    [70, 100],
    [30, 100],
    [0, 70],
    [0, 30],
  ],
  rightArrow: [
    [0, 25],
    [60, 25],
    [60, 0],
    [100, 50],
    [60, 100],
    [60, 75],
    [0, 75],
  ],
  leftArrow: [
    [40, 0],
    [40, 25],
    [100, 25],
    [100, 75],
    [40, 75],
    [40, 100],
    [0, 50],
  ],
  upArrow: [
    [0, 40],
    [50, 0],
    [100, 40],
    [75, 40],
    [75, 100],
    [25, 100],
    [25, 40],
  ],
  downArrow: [
    [25, 0],
    [75, 0],
    [75, 60],
    [100, 60],
    [50, 100],
    [0, 60],
    [25, 60],
  ],
  leftRightArrow: [
    [0, 50],
    [25, 0],
    [25, 25],
    [75, 25],
    [75, 0],
    [100, 50],
    [75, 100],
    [75, 75],
    [25, 75],
    [25, 100],
  ],
  upDownArrow: [
    [50, 0],
    [100, 25],
    [75, 25],
    [75, 75],
    [100, 75],
    [50, 100],
    [0, 75],
    [25, 75],
    [25, 25],
    [0, 25],
  ],
  chevron: [
    [0, 0],
    [75, 0],
    [100, 50],
    [75, 100],
    [0, 100],
    [25, 50],
  ],
  homePlate: [
    [0, 0],
    [75, 0],
    [100, 50],
    [75, 100],
    [0, 100],
  ],
  plus: [
    [35, 0],
    [65, 0],
    [65, 35],
    [100, 35],
    [100, 65],
    [65, 65],
    [65, 100],
    [35, 100],
    [35, 65],
    [0, 65],
    [0, 35],
    [35, 35],
  ],
  mathPlus: [
    [40, 0],
    [60, 0],
    [60, 40],
    [100, 40],
    [100, 60],
    [60, 60],
    [60, 100],
    [40, 100],
    [40, 60],
    [0, 60],
    [0, 40],
    [40, 40],
  ],
  star4: [
    [50, 0],
    [64, 36],
    [100, 50],
    [64, 64],
    [50, 100],
    [36, 64],
    [0, 50],
    [36, 36],
  ],
  star5: [
    [50, 0],
    [61, 35],
    [98, 35],
    [68, 57],
    [79, 91],
    [50, 70],
    [21, 91],
    [32, 57],
    [2, 35],
    [39, 35],
  ],
  star6: [
    [50, 0],
    [63, 25],
    [93, 25],
    [75, 50],
    [93, 75],
    [63, 75],
    [50, 100],
    [37, 75],
    [7, 75],
    [25, 50],
    [7, 25],
    [37, 25],
  ],
};

interface ShapeGeo {
  radiusCss?: string;
  clipCss?: string;
  points?: [number, number][];
}

/** Resolve a shape's geometry to CSS: a border-radius for rect/round/ellipse,
 *  or a polygon clip-path (+ points for stroking) for known presets. */
function shapeGeometry(spPr: Element | undefined, w: number, h: number): ShapeGeo {
  const prst = child(spPr, "a:prstGeom")?.getAttribute("prst");
  if (!prst) return {};
  if (prst === "ellipse") return { radiusCss: "border-radius:50%" };
  if (prst === "roundRect" || prst === "round1Rect" || prst === "round2SameRect" || prst === "round2DiagRect") {
    const radius = geometryStyle(spPr, w, h); // reuse adj parsing → "border-radius:Npx;"
    return { radiusCss: radius ? radius.replace(/;$/, "") : undefined };
  }
  const poly = PRESET_POLY[prst];
  if (poly) {
    const clip = poly.map(([x, y]) => `${x}% ${y}%`).join(",");
    return { clipCss: `clip-path:polygon(${clip})`, points: poly };
  }
  return {};
}

/** Outline a clipped polygon shape with an overlaid SVG stroke that follows the
 *  silhouette (a CSS border would be rectangular and clipped). */
function polygonOutline(points: [number, number][], line: LineStyle): string {
  const pts = points.map(([x, y]) => `${x},${y}`).join(" ");
  const dashAttr =
    line.dash === "dashed" ? ' stroke-dasharray="4 3"' : line.dash === "dotted" ? ' stroke-dasharray="1 3"' : "";
  return (
    `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;">` +
    `<polygon points="${pts}" fill="none" stroke="${line.color}" stroke-width="${line.widthPx}" vector-effect="non-scaling-stroke"${dashAttr}/></svg>`
  );
}

// --- Effects ---

interface Shadow {
  dx: number;
  dy: number;
  blur: number;
  color: string;
}

function shadowParts(spPr: Element | undefined, env: ColorEnv): Shadow | null {
  const shdw = descend(spPr, "a:effectLst", "a:outerShdw");
  if (!shdw) return null;
  const color = resolveColorIn(shdw, env) ?? "rgba(0,0,0,0.4)";
  const blur = emuToPx(intAttr(shdw, "blurRad") ?? 0);
  const dist = emuToPx(intAttr(shdw, "dist") ?? 0);
  const dirDeg = ((intAttr(shdw, "dir") ?? 0) / 60000) * (Math.PI / 180);
  const dx = Math.round(dist * Math.cos(dirDeg) * 100) / 100;
  const dy = Math.round(dist * Math.sin(dirDeg) * 100) / 100;
  return { dx, dy, blur, color };
}

// --- Shape (p:sp) ---

async function renderShape(sp: Element, part: PartCtx, ctx: SlideCtx, opts: TreeOpts): Promise<string> {
  const ph = getPhInfo(sp);
  if (opts.skipPlaceholders && ph) return "";

  const spPr = child(sp, "p:spPr");
  const env: ColorEnv = { theme: ctx.theme, clrMap: ctx.clrMap };

  // Resolve transform with placeholder inheritance: slide → layout → master
  let xfrm = parseXfrm(child(spPr, "a:xfrm"));
  let layoutPh: Element | undefined;
  let masterPh: Element | undefined;
  if (ph) {
    layoutPh = findPlaceholder(ctx.layoutDoc, ph);
    masterPh = findPlaceholder(ctx.masterDoc, ph);
    if (!xfrm) xfrm = parseXfrm(descend(layoutPh, "p:spPr", "a:xfrm"));
    if (!xfrm) xfrm = parseXfrm(descend(masterPh, "p:spPr", "a:xfrm"));
  }
  if (!xfrm) return "";

  // Style references (themed shapes)
  const style = child(sp, "p:style");
  const fillRef = child(style, "a:fillRef");
  const lnRef = child(style, "a:lnRef");
  const fontRef = child(style, "a:fontRef");

  // Fill: explicit → style reference
  let bgCss: string | undefined;
  const explicitFill = findFillElement(spPr);
  if (explicitFill) {
    bgCss = await fillToCss(explicitFill, env, ctx, part);
  } else if (fillRef) {
    const ref = resolveStyleRef(fillRef, ctx.theme.fillStyles, ctx.theme.bgFillStyles, env);
    if (ref) {
      bgCss = await fillToCss(ref.fill, { ...env, phClr: ref.phClr ? `#${ref.phClr}` : undefined }, ctx, part);
    } else {
      bgCss = resolveColorIn(fillRef, env);
    }
  }

  // Border: explicit → style reference. An explicit a:ln that resolves to no
  // style (noFill) deliberately suppresses the themed outline, hence the
  // `!ln` check rather than just `!line`.
  const ln = child(spPr, "a:ln");
  let line = lineToStyle(ln, env);
  if (!line && !ln && lnRef) {
    const refColor = resolveColorIn(lnRef, env);
    const idx = intAttr(lnRef, "idx") ?? 0;
    if (refColor && idx > 0) {
      const themedLn = ctx.theme.lineStyles[Math.min(idx - 1, ctx.theme.lineStyles.length - 1)];
      const w = themedLn ? (intAttr(themedLn, "w") ?? 9525) : 9525;
      // Only apply themed outlines to shapes that actually have a themed fill;
      // text boxes (fillRef idx 0) stay borderless.
      if (explicitFill || (fillRef && (intAttr(fillRef, "idx") ?? 0) > 0)) {
        line = { widthPx: Math.max(emuToPx(w), 0.5), color: refColor, dash: "solid" };
      }
    }
  }

  const geo = shapeGeometry(spPr, xfrm.w, xfrm.h);
  const shadow = shadowParts(spPr, env);

  // Background/border layer (kept separate so overflowing text doesn't stretch it)
  let bgLayer = "";
  const hasFill = !!bgCss && bgCss !== "transparent";
  if (hasFill || line || shadow) {
    const styles = ["position:absolute", "inset:0"];
    if (hasFill) styles.push(`background:${bgCss}`);
    if (geo.radiusCss) styles.push(geo.radiusCss);
    if (geo.clipCss) styles.push(geo.clipCss);
    // A clip-path also clips box-shadow, so clipped shapes use a
    // silhouette-following drop-shadow filter instead.
    if (shadow) {
      if (geo.clipCss)
        styles.push(`filter:drop-shadow(${shadow.dx}px ${shadow.dy}px ${px(shadow.blur)} ${shadow.color})`);
      else styles.push(`box-shadow:${shadow.dx}px ${shadow.dy}px ${px(shadow.blur)} ${shadow.color}`);
    }
    // Outline: rect/rounded shapes use a CSS border; clipped polygons are
    // stroked with an overlaid SVG so the line follows the silhouette.
    let svgOutline = "";
    if (line && !geo.points) {
      styles.push(`border:${px(line.widthPx)} ${line.dash} ${line.color}`);
    } else if (line && geo.points) {
      svgOutline = polygonOutline(geo.points, line);
    }
    bgLayer = `<div style="${styles.join(";")};"></div>${svgOutline}`;
  }

  // Text
  const txBody = child(sp, "p:txBody");
  let textHtml = "";
  if (txBody) {
    const fontRefColor = resolveColorIn(fontRef, env);
    textHtml = renderTextBody(txBody, {
      ctx,
      part,
      ph,
      layoutPh,
      masterPh,
      fontRefColor,
    });
  }

  return `<div style="${positionStyle(xfrm, opts)}">${bgLayer}${textHtml}</div>`;
}

// ============================================================================
// Text rendering
// ============================================================================

interface TextEnv {
  ctx: SlideCtx;
  part: PartCtx;
  ph: PhInfo | null;
  layoutPh?: Element;
  masterPh?: Element;
  fontRefColor?: string;
  /** Render in normal document flow (table cells) instead of absolutely positioned */
  flow?: boolean;
}

/** Collect the level-specific paragraph-property chain for style inheritance. */
function buildLevelChain(tenv: TextEnv, txBody: Element, lvl: number): Element[] {
  const chain: Element[] = [];
  const lvlTag = `a:lvl${lvl + 1}pPr`;

  const pushFrom = (lstStyle: Element | undefined) => {
    const lvlPr = child(lstStyle, lvlTag);
    if (lvlPr) chain.push(lvlPr);
  };

  // Shape's own list style
  pushFrom(child(txBody, "a:lstStyle"));

  // Layout & master placeholder list styles
  pushFrom(descend(tenv.layoutPh, "p:txBody", "a:lstStyle"));
  pushFrom(descend(tenv.masterPh, "p:txBody", "a:lstStyle"));

  // Master global text styles apply to PLACEHOLDERS by type. Non-placeholder
  // shapes take their text defaults from the shape style's fontRef (resolved in
  // renderRun); applying otherStyle here would force tx1 (black) onto themed
  // colored shapes whose fontRef is light (white) — the common "filled shape
  // with white text" case.
  const masterDoc = tenv.ctx.masterDoc;
  if (masterDoc && tenv.ph) {
    const txStyles = masterDoc.getElementsByTagName("p:txStyles")[0];
    if (txStyles) {
      const phType = tenv.ph.type;
      const sectionName =
        phType === "title" || phType === "ctrTitle"
          ? "p:titleStyle"
          : phType === "dt" || phType === "ftr" || phType === "sldNum"
            ? "p:otherStyle"
            : "p:bodyStyle";
      pushFrom(child(txStyles, sectionName));
    }
  }

  return chain;
}

function chainAttr(chain: (Element | undefined)[], attr: string): string | undefined {
  for (const el of chain) {
    const v = el?.getAttribute(attr);
    if (v != null) return v;
  }
  return undefined;
}

function chainIntAttr(chain: (Element | undefined)[], attr: string): number | undefined {
  const v = chainAttr(chain, attr);
  if (v == null) return undefined;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

function chainChild(chain: (Element | undefined)[], name: string): Element | undefined {
  for (const el of chain) {
    const c = child(el, name);
    if (c) return c;
  }
  return undefined;
}

/** First chain element that declares any bullet → its bullet definition. */
function chainBullet(chain: (Element | undefined)[]): Element | undefined {
  for (const el of chain) {
    if (!el) continue;
    for (const name of ["a:buNone", "a:buChar", "a:buAutoNum"]) {
      const c = child(el, name);
      if (c) return c;
    }
  }
  return undefined;
}

function formatAutoNum(scheme: string, n: number): string {
  let body: string;
  if (scheme.startsWith("alphaLc")) body = toAlpha(n);
  else if (scheme.startsWith("alphaUc")) body = toAlpha(n).toUpperCase();
  else if (scheme.startsWith("romanLc")) body = toRoman(n);
  else if (scheme.startsWith("romanUc")) body = toRoman(n).toUpperCase();
  else body = String(n);

  if (scheme.endsWith("ParenBoth")) return `(${body})`;
  if (scheme.endsWith("ParenR")) return `${body})`;
  if (scheme.endsWith("Period")) return `${body}.`;
  return body;
}

function renderTextBody(txBody: Element, tenv: TextEnv): string {
  const { ctx } = tenv;
  const env: ColorEnv = { theme: ctx.theme, clrMap: ctx.clrMap };

  const bodyPr =
    child(txBody, "a:bodyPr") ??
    descend(tenv.layoutPh, "p:txBody", "a:bodyPr") ??
    descend(tenv.masterPh, "p:txBody", "a:bodyPr");

  // Insets (defaults: 0.1" left/right, 0.05" top/bottom)
  const lIns = emuToPx(intAttr(bodyPr, "lIns") ?? 91440);
  const rIns = emuToPx(intAttr(bodyPr, "rIns") ?? 91440);
  const tIns = emuToPx(intAttr(bodyPr, "tIns") ?? 45720);
  const bIns = emuToPx(intAttr(bodyPr, "bIns") ?? 45720);

  const anchor = bodyPr?.getAttribute("anchor") || "t";
  const justify = anchor === "ctr" ? "center" : anchor === "b" ? "flex-end" : "flex-start";
  const noWrap = bodyPr?.getAttribute("wrap") === "none";

  // Autofit shrink
  const autofit = child(bodyPr, "a:normAutofit");
  const fontScale = (intAttr(autofit, "fontScale") ?? 100000) / 100000;
  const lnSpcReduction = (intAttr(autofit, "lnSpcReduction") ?? 0) / 100000;

  const paragraphs = childList(txBody, "a:p");
  const counters: number[] = [];
  const out: string[] = [];

  for (const p of paragraphs) {
    const pPr = child(p, "a:pPr");
    const lvl = intAttr(pPr, "lvl") ?? 0;
    const lvlChain = buildLevelChain(tenv, txBody, lvl);
    const pChain: (Element | undefined)[] = [pPr, ...lvlChain];
    // defRPr chain for run-level defaults (nearest first)
    const defRPrChain = pChain.map((el) => child(el, "a:defRPr")).filter(Boolean) as Element[];

    // Paragraph alignment & indentation
    const algn = chainAttr(pChain, "algn");
    const textAlign = algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" ? "justify" : "left";

    // Bullet
    const bullet = chainBullet(pChain);
    const hasBullet = !!bullet && bullet.tagName !== "a:buNone";

    let marL = chainIntAttr(pChain, "marL");
    let indent = chainIntAttr(pChain, "indent");
    if (marL == null) marL = hasBullet ? 342900 * (lvl + 1) : 457200 * lvl;
    if (indent == null) indent = hasBullet ? -342900 : 0;

    // Spacing
    const lnSpcPct = intAttr(
      chainChild(
        pChain.map((e) => child(e, "a:lnSpc")),
        "a:spcPct",
      ),
      "val",
    );
    const lnSpcPts = intAttr(
      chainChild(
        pChain.map((e) => child(e, "a:lnSpc")),
        "a:spcPts",
      ),
      "val",
    );
    // Paragraph spacing: spcPts is absolute (hundredths of a point), spcPct
    // is a percentage of a single line at the paragraph's font size.
    const paraSpacingPx = (which: "a:spcBef" | "a:spcAft", lineSizePx: number): number => {
      const spc = chainChild(
        pChain.map((e) => child(e, which)),
        "a:spcPts",
      );
      if (spc) return ptToPx((intAttr(spc, "val") ?? 0) / 100);
      const pct = chainChild(
        pChain.map((e) => child(e, which)),
        "a:spcPct",
      );
      if (pct) return ((intAttr(pct, "val") ?? 0) / 100000) * lineSizePx * 1.2;
      return 0;
    };

    let lineHeight: string;
    if (lnSpcPts != null) {
      lineHeight = px(ptToPx(lnSpcPts / 100));
    } else {
      const mult = ((lnSpcPct ?? 100000) / 100000) * 1.2 * (1 - lnSpcReduction);
      lineHeight = `${Math.round(mult * 1000) / 1000}`;
    }

    // Runs (rendered first — bullets only apply to paragraphs with content)
    const runParts: string[] = [];
    for (const node of p.children) {
      if (node.tagName === "a:r" || node.tagName === "a:fld") {
        runParts.push(renderRun(node, defRPrChain, tenv, fontScale));
      } else if (node.tagName === "a:br") {
        runParts.push("<br/>");
      }
    }
    const content = runParts.join("");

    // Paragraph font size drives the CSS line-box strut, so it must follow
    // the paragraph's actual runs — a larger phantom default would inflate
    // the line pitch and vertically shift the text. Empty paragraphs take
    // their height from a:endParaRPr (what PowerPoint sizes blank lines by).
    let szSource: (Element | undefined)[];
    if (content) {
      let firstRunRPr: Element | undefined;
      for (const node of p.children) {
        if (node.tagName === "a:r" || node.tagName === "a:fld") {
          firstRunRPr = child(node, "a:rPr");
          break;
        }
      }
      szSource = [firstRunRPr, ...defRPrChain];
    } else {
      szSource = [child(p, "a:endParaRPr"), ...defRPrChain];
    }
    const defaultSzAttr = chainAttr(szSource, "sz");
    const defaultSzPt = (defaultSzAttr ? parseInt(defaultSzAttr, 10) / 100 : 18) * fontScale;

    const pStyles = [
      `text-align:${textAlign}`,
      `line-height:${lineHeight}`,
      `padding-left:${px(emuToPx(marL))}`,
      `text-indent:${px(emuToPx(indent))}`,
      `font-size:${px(ptToPx(defaultSzPt))}`,
      "white-space:pre-wrap",
      "word-wrap:break-word",
    ];
    if (noWrap) pStyles[pStyles.indexOf("white-space:pre-wrap")] = "white-space:nowrap";
    const lineSizePx = ptToPx(defaultSzPt);
    const spcBef = paraSpacingPx("a:spcBef", lineSizePx);
    const spcAft = paraSpacingPx("a:spcAft", lineSizePx);
    if (spcBef) pStyles.push(`margin-top:${px(spcBef)}`);
    if (spcAft) pStyles.push(`margin-bottom:${px(spcAft)}`);

    // Bullet marker — PowerPoint shows no bullet on empty paragraphs and
    // doesn't advance auto-numbering for them either.
    let bulletHtml = "";
    if (hasBullet && bullet && content) {
      let marker = "";
      if (bullet.tagName === "a:buChar") {
        const raw = bullet.getAttribute("char") || "•";
        const buFont = chainChild(pChain, "a:buFont")?.getAttribute("typeface") || "";
        marker = mapBulletChar(raw, buFont);
      } else {
        // Auto numbering with per-level counters
        const startAt = intAttr(bullet, "startAt") ?? 1;
        counters[lvl] = (counters[lvl] ?? startAt - 1) + 1;
        counters.length = lvl + 1;
        marker = formatAutoNum(bullet.getAttribute("type") || "arabicPeriod", counters[lvl]);
      }

      const buClr = resolveColorIn(chainChild(pChain, "a:buClr"), env);
      const buSzPct = intAttr(chainChild(pChain, "a:buSzPct"), "val");
      const buStyles: string[] = ["display:inline-block", `min-width:${px(emuToPx(Math.abs(indent)))}`];
      if (buClr) buStyles.push(`color:${buClr}`);
      if (buSzPct) buStyles.push(`font-size:${Math.round(buSzPct / 1000)}%`);
      bulletHtml = `<span style="${buStyles.join(";")};">${escapeHtml(marker)}</span>`;
    }

    out.push(`<div style="${pStyles.join(";")};">${bulletHtml}${content || "<br/>"}</div>`);
  }

  if (tenv.flow) {
    return `<div>${out.join("")}</div>`;
  }

  const containerStyles = [
    "position:absolute",
    "inset:0",
    `padding:${px(tIns)} ${px(rIns)} ${px(bIns)} ${px(lIns)}`,
    "display:flex",
    "flex-direction:column",
    `justify-content:${justify}`,
  ];

  // normAutofit means "shrink text until it fits the shape". PowerPoint
  // recomputes this at render time (the stored fontScale is just a cache and
  // is often missing from generator-produced files), so flag the container
  // for the in-document autofit script.
  //
  // Slide-level bodies without declared autofit get a "soft" pass: only if
  // the content overflows its shape badly (>25%) do we shrink, with a 40%
  // floor. PowerPoint would paint such text over neighboring shapes; for a
  // preview, degrading gracefully beats faithfully overlapping — and decks
  // whose text fits are never touched.
  let autofitAttr = "";
  if (autofit) autofitAttr = ' data-autofit="norm"';
  else if (!noWrap && tenv.part.path === tenv.ctx.slide.path) autofitAttr = ' data-autofit="soft"';

  return `<div${autofitAttr} style="${containerStyles.join(";")};">${out.join("")}</div>`;
}

function renderRun(r: Element, defRPrChain: Element[], tenv: TextEnv, fontScale: number): string {
  const { ctx } = tenv;
  const env: ColorEnv = { theme: ctx.theme, clrMap: ctx.clrMap };
  const rPr = child(r, "a:rPr");
  const chain: (Element | undefined)[] = [rPr, ...defRPrChain];

  let text = child(r, "a:t")?.textContent ?? "";

  // Live slide-number fields
  if (r.tagName === "a:fld" && r.getAttribute("type") === "slidenum") {
    text = String(ctx.slideNum);
  }
  if (!text) return "";

  const styles: string[] = [];

  const szAttr = chainAttr(chain, "sz");
  const szPt = (szAttr ? parseInt(szAttr, 10) / 100 : 18) * fontScale;
  styles.push(`font-size:${px(ptToPx(szPt))}`);

  const b = chainAttr(chain, "b");
  if (b === "1") styles.push("font-weight:bold");
  const i = chainAttr(chain, "i");
  if (i === "1") styles.push("font-style:italic");

  // Caps (corporate templates often force ALL CAPS titles via cap="all").
  const cap = chainAttr(chain, "cap");
  if (cap === "all") styles.push("text-transform:uppercase");
  else if (cap === "small") styles.push("font-variant:small-caps");

  const u = chainAttr(chain, "u");
  const strike = chainAttr(chain, "strike");
  const deco: string[] = [];
  if (u && u !== "none") deco.push("underline");
  if (strike && strike !== "noStrike") deco.push("line-through");
  if (deco.length) styles.push(`text-decoration:${deco.join(" ")}`);

  // Letter spacing (hundredths of a point)
  const spc = chainAttr(chain, "spc");
  if (spc) styles.push(`letter-spacing:${px(ptToPx(parseInt(spc, 10) / 100))}`);

  // Superscript / subscript
  const baseline = chainAttr(chain, "baseline");
  if (baseline) {
    const pct = parseInt(baseline, 10) / 1000;
    if (pct > 0) styles.push("vertical-align:super;font-size:0.65em");
    else if (pct < 0) styles.push("vertical-align:sub;font-size:0.65em");
  }

  // Font family
  let font = chainChild(chain, "a:latin")?.getAttribute("typeface") || "";
  if (font === "+mj-lt") font = ctx.theme.majorFont;
  else if (font === "+mn-lt") font = ctx.theme.minorFont;
  if (!font && (tenv.ph?.type === "title" || tenv.ph?.type === "ctrTitle")) font = ctx.theme.majorFont;
  if (font) styles.push(`font-family:${cssFontStack(font)}`);

  // Hyperlink
  const hlink = child(rPr, "a:hlinkClick");
  const linkRId = getRId(hlink, "id");
  const linkRel = linkRId ? tenv.part.rels.get(linkRId) : undefined;
  const href = linkRel?.external ? linkRel.target : undefined;

  // Color: explicit on the run → hyperlink scheme color → inherited → font style ref.
  // PowerPoint colors hyperlinks with the hlink theme color unless the run
  // itself carries an explicit override, so the link color outranks the chain.
  let color = resolveColorIn(child(rPr, "a:solidFill"), env);
  if (!color && href && ctx.theme.colors.hlink) color = `#${ctx.theme.colors.hlink}`;
  if (!color) color = resolveColorIn(chainChild(chain, "a:solidFill"), env);
  if (!color) color = tenv.fontRefColor;
  if (color) styles.push(`color:${color}`);

  // Highlight
  const highlight = resolveColorIn(child(rPr, "a:highlight"), env);
  if (highlight) styles.push(`background-color:${highlight}`);

  const span = `<span style="${styles.join(";")};">${escapeHtml(text)}</span>`;
  if (href) {
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${span}</a>`;
  }
  return span;
}

// ============================================================================
// Pictures
// ============================================================================

async function renderPicture(pic: Element, part: PartCtx, ctx: SlideCtx, opts: TreeOpts): Promise<string> {
  const ph = getPhInfo(pic);
  if (opts.skipPlaceholders && ph) return "";

  const spPr = child(pic, "p:spPr");
  let xfrm = parseXfrm(child(spPr, "a:xfrm"));
  if (!xfrm && ph) {
    xfrm =
      parseXfrm(descend(findPlaceholder(ctx.layoutDoc, ph), "p:spPr", "a:xfrm")) ??
      parseXfrm(descend(findPlaceholder(ctx.masterDoc, ph), "p:spPr", "a:xfrm"));
  }
  if (!xfrm) return "";

  const blipFill = child(pic, "p:blipFill");
  const rId = getRId(child(blipFill, "a:blip"));
  const rel = rId ? part.rels.get(rId) : undefined;
  if (!rel || rel.external) return "";

  const url = await loadMedia(ctx.shared, resolveTarget(part.path, rel.target));
  if (!url) return "";

  const env: ColorEnv = { theme: ctx.theme, clrMap: ctx.clrMap };
  const geo = shapeGeometry(spPr, xfrm.w, xfrm.h);
  const line = lineToStyle(child(spPr, "a:ln"), env);
  const shadow = shadowParts(spPr, env);

  // Crop (a:srcRect, values in 1000ths of a percent)
  const srcRect = child(blipFill, "a:srcRect");
  let imgStyle = "width:100%;height:100%;display:block;";
  if (srcRect) {
    const l = (intAttr(srcRect, "l") ?? 0) / 100000;
    const t = (intAttr(srcRect, "t") ?? 0) / 100000;
    const rr = (intAttr(srcRect, "r") ?? 0) / 100000;
    const bb = (intAttr(srcRect, "b") ?? 0) / 100000;
    const wPct = 100 / Math.max(1 - l - rr, 0.01);
    const hPct = 100 / Math.max(1 - t - bb, 0.01);
    imgStyle =
      `position:absolute;width:${Math.round(wPct * 100) / 100}%;height:${Math.round(hPct * 100) / 100}%;` +
      `left:${Math.round(-wPct * l * 100) / 100}%;top:${Math.round(-hPct * t * 100) / 100}%;display:block;`;
  }

  const wrapperStyles = [positionStyle(xfrm, opts), "overflow:hidden"];
  if (geo.radiusCss) wrapperStyles.push(geo.radiusCss);
  if (geo.clipCss) wrapperStyles.push(geo.clipCss);
  if (shadow) {
    if (geo.clipCss) {
      wrapperStyles.push(`filter:drop-shadow(${shadow.dx}px ${shadow.dy}px ${px(shadow.blur)} ${shadow.color})`);
    } else {
      wrapperStyles.push(`box-shadow:${shadow.dx}px ${shadow.dy}px ${px(shadow.blur)} ${shadow.color}`);
    }
  }
  // Outline: rounded/rect pictures use a CSS border; polygon-cropped pictures
  // (crop-to-shape) get a silhouette-following SVG stroke.
  let svgOutline = "";
  if (line && !geo.points) {
    wrapperStyles.push(`border:${px(line.widthPx)} ${line.dash} ${line.color}`);
  } else if (line && geo.points) {
    svgOutline = polygonOutline(geo.points, line);
  }

  return `<div style="${wrapperStyles.join(";")}"><img src="${url}" alt="" style="${imgStyle}"/>${svgOutline}</div>`;
}

// ============================================================================
// Groups
// ============================================================================

async function renderGroup(grp: Element, part: PartCtx, ctx: SlideCtx, opts: TreeOpts): Promise<string> {
  const grpSpPr = child(grp, "p:grpSpPr");
  const xfrmEl = child(grpSpPr, "a:xfrm");
  const xfrm = parseXfrm(xfrmEl);
  if (!xfrm) return "";

  const chOff = child(xfrmEl, "a:chOff");
  const chExt = child(xfrmEl, "a:chExt");
  const chX = emuToPx(intAttr(chOff, "x") ?? 0);
  const chY = emuToPx(intAttr(chOff, "y") ?? 0);
  const chW = emuToPx(intAttr(chExt, "cx") ?? 0) || xfrm.w;
  const chH = emuToPx(intAttr(chExt, "cy") ?? 0) || xfrm.h;

  const sx = chW ? xfrm.w / chW : 1;
  const sy = chH ? xfrm.h / chH : 1;

  const children = await renderShapeTree(grp, part, ctx, {
    ...opts,
    origin: { x: chX, y: chY },
  });

  return (
    `<div style="${positionStyle(xfrm, opts)}">` +
    `<div style="position:absolute;left:0;top:0;width:${px(chW)};height:${px(chH)};` +
    `transform:scale(${Math.round(sx * 10000) / 10000},${Math.round(sy * 10000) / 10000});transform-origin:0 0;">` +
    `${children}</div></div>`
  );
}

// ============================================================================
// Connectors (lines)
// ============================================================================

function renderConnector(cxn: Element, ctx: SlideCtx, opts: TreeOpts): string {
  const spPr = child(cxn, "p:spPr");
  const xfrm = parseXfrm(child(spPr, "a:xfrm"));
  if (!xfrm) return "";

  const env: ColorEnv = { theme: ctx.theme, clrMap: ctx.clrMap };
  let line = lineToStyle(child(spPr, "a:ln"), env);
  if (!line) {
    const lnRef = descend(cxn, "p:style", "a:lnRef");
    const refColor = resolveColorIn(lnRef, env);
    if (refColor) line = { widthPx: 1, color: refColor, dash: "solid" };
  }
  if (!line) return "";

  const w = Math.max(xfrm.w, 1);
  const h = Math.max(xfrm.h, 1);
  // Default connector runs top-left → bottom-right; flips reverse the axes
  const x1 = xfrm.flipH ? w : 0;
  const y1 = xfrm.flipV ? h : 0;
  const x2 = xfrm.flipH ? 0 : w;
  const y2 = xfrm.flipV ? 0 : h;

  const dashAttr =
    line.dash === "dashed" ? ' stroke-dasharray="6,4"' : line.dash === "dotted" ? ' stroke-dasharray="2,3"' : "";

  return (
    `<div style="${positionStyle({ ...xfrm, flipH: false, flipV: false }, opts)}pointer-events:none;">` +
    `<svg width="${Math.ceil(w)}" height="${Math.ceil(h)}" style="overflow:visible;display:block;">` +
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${line.color}" stroke-width="${line.widthPx}"${dashAttr}/>` +
    `</svg></div>`
  );
}

// ============================================================================
// Graphic frames (tables, charts)
// ============================================================================

async function renderGraphicFrame(frame: Element, part: PartCtx, ctx: SlideCtx, opts: TreeOpts): Promise<string> {
  const xfrm = parseXfrm(child(frame, "p:xfrm"));
  if (!xfrm) return "";

  const graphicData = descend(frame, "a:graphic", "a:graphicData");
  const tbl = child(graphicData, "a:tbl");
  if (tbl) {
    return renderTable(tbl, xfrm, part, ctx, opts);
  }

  const uri = graphicData?.getAttribute("uri") || "";
  if (uri.includes("/chart")) {
    const rId = getRId(child(graphicData, "c:chart"), "id");
    const rel = rId ? part.rels.get(rId) : undefined;
    if (rel && !rel.external) {
      const chartDoc = await loadXml(ctx.shared, resolveTarget(part.path, rel.target));
      if (chartDoc) {
        const env: ColorEnv = { theme: ctx.theme, clrMap: ctx.clrMap };
        const accents = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"].map((a) =>
          ctx.theme.colors[a] ? `#${ctx.theme.colors[a]}` : undefined,
        );
        const resolveFill: FillResolver = (sp) => {
          const f = findFillElement(sp);
          return f ? resolveColorIn(f, env) : undefined;
        };
        const data = parseChart(chartDoc, resolveFill, accents);
        if (data?.series.length) {
          return `<div style="${positionStyle(xfrm, opts)}background:#fff;overflow:hidden;">${renderChartSvg(data, xfrm.w, xfrm.h)}</div>`;
        }
      }
    }
  }
  if (uri.includes("/chart") || uri.includes("/diagram")) {
    const label = uri.includes("/chart") ? "Chart" : "Diagram";
    return (
      `<div style="${positionStyle(xfrm, opts)}display:flex;align-items:center;justify-content:center;` +
      `border:1px dashed #c0c0c0;border-radius:6px;color:#909090;font-size:13px;background:rgba(0,0,0,0.02);">` +
      `${label} (not rendered)</div>`
    );
  }
  return "";
}

// --- Tables ---

interface TableStylePart {
  fill?: string;
  bold?: boolean;
  color?: string;
  borders?: Partial<Record<"L" | "R" | "T" | "B" | "insideH" | "insideV", LineStyle>>;
}

function parseTableStylePart(el: Element | undefined, env: ColorEnv): TableStylePart | undefined {
  if (!el) return undefined;
  const out: TableStylePart = {};

  const tcStyle = child(el, "a:tcStyle");
  if (tcStyle) {
    const fillEl = child(tcStyle, "a:fill");
    out.fill = resolveColorIn(child(fillEl, "a:solidFill"), env);
    if (!out.fill) {
      const fillRef = child(tcStyle, "a:fillRef");
      out.fill = resolveColorIn(fillRef, env);
    }

    const tcBdr = child(tcStyle, "a:tcBdr");
    if (tcBdr) {
      out.borders = {};
      const sides: ["L" | "R" | "T" | "B" | "insideH" | "insideV", string][] = [
        ["L", "a:left"],
        ["R", "a:right"],
        ["T", "a:top"],
        ["B", "a:bottom"],
        ["insideH", "a:insideH"],
        ["insideV", "a:insideV"],
      ];
      for (const [key, tag] of sides) {
        const ln = child(child(tcBdr, tag), "a:ln");
        const style = lineToStyle(ln, env);
        if (style) out.borders[key] = style;
      }
    }
  }

  const tcTxStyle = child(el, "a:tcTxStyle");
  if (tcTxStyle) {
    if (tcTxStyle.getAttribute("b") === "on") out.bold = true;
    out.color = resolveColorIn(tcTxStyle, env) ?? resolveColor(child(tcTxStyle, "a:schemeClr"), env);
  }

  return out;
}

function renderTable(tbl: Element, xfrm: Xfrm, part: PartCtx, ctx: SlideCtx, opts: TreeOpts): string {
  const env: ColorEnv = { theme: ctx.theme, clrMap: ctx.clrMap };

  const tblPr = child(tbl, "a:tblPr");
  const firstRowOn = boolAttr(tblPr, "firstRow") ?? false;
  const bandRowOn = boolAttr(tblPr, "bandRow") ?? false;

  // Table style lookup
  const styleId = child(tblPr, "a:tableStyleId")?.textContent?.trim();
  const tblStyle = styleId ? ctx.shared.tableStyles.get(styleId) : undefined;
  const wholeTbl = parseTableStylePart(child(tblStyle, "a:wholeTbl"), env);
  const firstRowStyle = parseTableStylePart(child(tblStyle, "a:firstRow"), env);
  const band1H = parseTableStylePart(child(tblStyle, "a:band1H"), env);

  const colWidths = childList(child(tbl, "a:tblGrid"), "a:gridCol").map((c) => emuToPx(intAttr(c, "w") ?? 0));
  const rows = childList(tbl, "a:tr");

  const colgroup = colWidths.map((w) => `<col style="width:${px(w)}"/>`).join("");
  const rowsHtml: string[] = [];

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const rowH = emuToPx(intAttr(row, "h") ?? 0);
    const cells = childList(row, "a:tc");
    const cellsHtml: string[] = [];

    const isHeader = firstRowOn && ri === 0;
    const dataRowIdx = firstRowOn ? ri - 1 : ri;
    const isBanded = bandRowOn && !isHeader && dataRowIdx % 2 === 0;

    for (const tc of cells) {
      // Skip merge continuation cells
      if (boolAttr(tc, "hMerge") || boolAttr(tc, "vMerge")) continue;

      const gridSpan = intAttr(tc, "gridSpan") ?? 1;
      const rowSpan = intAttr(tc, "rowSpan") ?? 1;
      const tcPr = child(tc, "a:tcPr");

      const styles: string[] = ["vertical-align:middle"];

      // Insets
      const cl = emuToPx(intAttr(tcPr, "marL") ?? 91440);
      const cr = emuToPx(intAttr(tcPr, "marR") ?? 91440);
      const ct = emuToPx(intAttr(tcPr, "marT") ?? 45720);
      const cb = emuToPx(intAttr(tcPr, "marB") ?? 45720);
      styles.push(`padding:${px(ct)} ${px(cr)} ${px(cb)} ${px(cl)}`);

      const anchor = tcPr?.getAttribute("anchor");
      if (anchor === "ctr") styles.push("vertical-align:middle");
      else if (anchor === "b") styles.push("vertical-align:bottom");
      else if (anchor === "t") styles.push("vertical-align:top");

      // Fill: explicit → style parts
      const explicitFill = resolveColorIn(child(tcPr, "a:solidFill"), env);
      const fill =
        explicitFill ?? (isHeader ? firstRowStyle?.fill : isBanded ? band1H?.fill : undefined) ?? wholeTbl?.fill;
      if (fill) styles.push(`background:${fill}`);

      // Borders: explicit per-side → style insides
      const sideMap: ["top" | "right" | "bottom" | "left", string, "T" | "R" | "B" | "L"][] = [
        ["left", "a:lnL", "L"],
        ["right", "a:lnR", "R"],
        ["top", "a:lnT", "T"],
        ["bottom", "a:lnB", "B"],
      ];
      for (const [cssSide, tag, key] of sideMap) {
        const explicit = lineToStyle(child(tcPr, tag), env);
        let ls = explicit;
        if (!ls) {
          const partStyle = isHeader ? firstRowStyle : undefined;
          ls = partStyle?.borders?.[key] ?? wholeTbl?.borders?.[key];
          // Use inside borders for inner edges
          if (!ls) {
            const inner =
              (cssSide === "top" && ri > 0) || (cssSide === "bottom" && ri < rows.length - 1)
                ? wholeTbl?.borders?.insideH
                : (cssSide === "left" || cssSide === "right") && cells.length > 1
                  ? wholeTbl?.borders?.insideV
                  : undefined;
            ls = inner;
          }
        }
        if (ls) styles.push(`border-${cssSide}:${px(ls.widthPx)} ${ls.dash} ${ls.color}`);
      }

      const txStylePart = isHeader ? firstRowStyle : wholeTbl;
      if (txStylePart?.bold) styles.push("font-weight:bold");
      if (txStylePart?.color) styles.push(`color:${txStylePart.color}`);

      // Cell text
      const txBody = child(tc, "a:txBody");
      let content = "";
      if (txBody) {
        content = renderTextBody(txBody, {
          ctx,
          part,
          ph: null,
          flow: true,
        });
      }

      const spanAttrs = `${gridSpan > 1 ? ` colspan="${gridSpan}"` : ""}${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ""}`;
      cellsHtml.push(`<td${spanAttrs} style="${styles.join(";")};">${content}</td>`);
    }

    rowsHtml.push(`<tr style="height:${px(rowH)};">${cellsHtml.join("")}</tr>`);
  }

  return (
    `<div style="${positionStyle(xfrm, opts)}">` +
    `<table style="width:100%;height:100%;"><colgroup>${colgroup}</colgroup><tbody>${rowsHtml.join("")}</tbody></table>` +
    `</div>`
  );
}
