import { child, childList, escapeHtml } from "./ooxml";

/**
 * Converts OMML (Office MathML, the `m:` namespace Word writes for equations)
 * to W3C MathML, which browsers render natively. This layer only maps
 * structure — the browser owns typesetting (spacing, italic/upright defaults,
 * stretchy glyphs). Mirrors the element→MathML mapping used by the reference
 * canvas renderer (@silurus/ooxml), but works directly off the OMML DOM
 * instead of a pre-parsed AST.
 *
 * Without this, `m:oMath` content is dropped entirely from the HTML preview.
 */

// Character classes for tokenizing a run into mi/mn/mo (ECMA-376 §22.1).
const BIN = "+−±∓×÷·∗⋅∘∙*/";
const REL = "=≠<>≤≥≈≡∼≅≃→←↔⇒∈∉⊂⊆⊃⊇∝≪≫⊥≔";
const OPEN = "([{⟨⌈⌊";
const CLOSE = ")]}⟩⌉⌋";
const PUNCT = ",;";

// Integrals place limits beside the operator; sums/products place them above/below.
const INTEGRAL_OPS = new Set([..."∫∬∭∮∯∰∱∲∳⨌"]);

/** OMML `m:val` of a named child property element. */
function mval(el: Element | undefined, name: string): string | null {
  return child(el, name)?.getAttribute("m:val") ?? null;
}

/** Concatenated text of a run's direct `m:t` children. */
function runText(r: Element): string {
  return childList(r, "m:t")
    .map((t) => t.textContent ?? "")
    .join("");
}

/** Map an OMML run style to a MathML mathvariant (null = MathML default). */
function runVariant(r: Element): string | null {
  const rPr = child(r, "m:rPr");
  if (!rPr) return null;
  // m:nor forces upright "normal" (non-math) text.
  if (child(rPr, "m:nor")) return "normal";
  switch (mval(rPr, "m:sty")) {
    case "p":
      return "normal";
    case "b":
      return "bold";
    case "bi":
      return "bold-italic";
    case "i":
      return null; // italic is the MathML default for single letters
    default:
      return null;
  }
}

/** Tokenize run text into mi/mn/mo elements by character class. */
function runToMathML(text: string, variant: string | null): string {
  const v = variant ? ` mathvariant="${variant}"` : "";
  let out = "";
  let numBuf = "";
  const flushNum = () => {
    if (numBuf) {
      out += `<mn${v}>${escapeHtml(numBuf)}</mn>`;
      numBuf = "";
    }
  };
  for (const ch of text) {
    if (ch === " ") {
      flushNum();
      out += '<mspace width="0.25em"/>';
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      numBuf += ch;
      continue;
    }
    flushNum();
    if (BIN.includes(ch) || REL.includes(ch) || PUNCT.includes(ch)) {
      out += `<mo>${escapeHtml(ch)}</mo>`;
    } else if (OPEN.includes(ch) || CLOSE.includes(ch)) {
      out += `<mo fence="true" stretchy="false">${escapeHtml(ch)}</mo>`;
    } else {
      out += `<mi${v}>${escapeHtml(ch)}</mi>`;
    }
  }
  flushNum();
  return out;
}

/** Convert a sequence of sibling OMML nodes. */
function seq(parent: Element | undefined): string {
  if (!parent) return "";
  return childList(parent).map(node).join("");
}

/** Convert an argument element (m:e / m:num / m:den / …) into a single mrow. */
function arg(el: Element | undefined): string {
  return `<mrow>${seq(el)}</mrow>`;
}

function fraction(el: Element): string {
  const type = mval(child(el, "m:fPr"), "m:type");
  const num = arg(child(el, "m:num"));
  const den = arg(child(el, "m:den"));
  if (type === "lin") return `<mrow>${num}<mo>/</mo>${den}</mrow>`;
  const attrs = type === "noBar" ? ' linethickness="0"' : type === "skw" ? ' bevelled="true"' : "";
  return `<mfrac${attrs}>${num}${den}</mfrac>`;
}

function radical(el: Element): string {
  const radicand = arg(child(el, "m:e"));
  const degHidden = mval(child(el, "m:radPr"), "m:degHide") === "1";
  const deg = child(el, "m:deg");
  if (!degHidden && deg && deg.children.length) return `<mroot>${radicand}${arg(deg)}</mroot>`;
  return `<msqrt>${seq(child(el, "m:e"))}</msqrt>`;
}

function nary(el: Element): string {
  const pr = child(el, "m:naryPr");
  const op = mval(pr, "m:chr") ?? "∫";
  const limLoc = mval(pr, "m:limLoc");
  const subHide = mval(pr, "m:subHide") === "1";
  const supHide = mval(pr, "m:supHide") === "1";
  const sub = subHide ? undefined : child(el, "m:sub");
  const sup = supHide ? undefined : child(el, "m:sup");
  const hasSub = !!sub && sub.children.length > 0;
  const hasSup = !!sup && sup.children.length > 0;
  const beside = limLoc === "subSup" ? true : limLoc === "undOvr" ? false : INTEGRAL_OPS.has(op);
  const o = `<mo largeop="true">${escapeHtml(op)}</mo>`;

  let operator: string;
  if (beside) {
    if (hasSub && hasSup) operator = `<msubsup>${o}${arg(sub)}${arg(sup)}</msubsup>`;
    else if (hasSub) operator = `<msub>${o}${arg(sub)}</msub>`;
    else if (hasSup) operator = `<msup>${o}${arg(sup)}</msup>`;
    else operator = o;
  } else {
    if (hasSub && hasSup) operator = `<munderover>${o}${arg(sub)}${arg(sup)}</munderover>`;
    else if (hasSub) operator = `<munder>${o}${arg(sub)}</munder>`;
    else if (hasSup) operator = `<mover>${o}${arg(sup)}</mover>`;
    else operator = o;
  }
  return `<mrow>${operator}${seq(child(el, "m:e"))}</mrow>`;
}

function delimiter(el: Element): string {
  const pr = child(el, "m:dPr");
  const beg = mval(pr, "m:begChr") ?? "(";
  const end = mval(pr, "m:endChr") ?? ")";
  const sep = mval(pr, "m:sepChr") ?? "|";
  const fence = (ch: string) => (ch ? `<mo fence="true" stretchy="true">${escapeHtml(ch)}</mo>` : "");
  const inner = childList(el, "m:e")
    .map((e) => arg(e))
    .join(`<mo separator="true">${escapeHtml(sep)}</mo>`);
  return `<mrow>${fence(beg)}${inner}${fence(end)}</mrow>`;
}

function groupChr(el: Element): string {
  const pr = child(el, "m:groupChrPr");
  const ch = mval(pr, "m:chr") ?? "⏟";
  const pos = mval(pr, "m:pos") ?? "bot";
  const tag = pos === "top" ? "mover" : "munder";
  return `<${tag}>${arg(child(el, "m:e"))}<mo stretchy="true">${escapeHtml(ch)}</mo></${tag}>`;
}

function bar(el: Element): string {
  const pos = mval(child(el, "m:barPr"), "m:pos") ?? "bot";
  const tag = pos === "top" ? "mover" : "munder";
  return `<${tag}>${arg(child(el, "m:e"))}<mo stretchy="true">&#x2015;</mo></${tag}>`;
}

function accent(el: Element): string {
  const ch = mval(child(el, "m:accPr"), "m:chr") ?? "̂"; // combining circumflex
  const stretchy = ch === "→" || ch === "←" ? "true" : "false";
  return `<mover accent="true">${arg(child(el, "m:e"))}<mo stretchy="${stretchy}">${escapeHtml(ch)}</mo></mover>`;
}

function matrix(el: Element): string {
  const rows = childList(el, "m:mr")
    .map(
      (mr) =>
        `<mtr>${childList(mr, "m:e")
          .map((e) => `<mtd>${seq(e)}</mtd>`)
          .join("")}</mtr>`,
    )
    .join("");
  return `<mtable rowspacing="0.2em" columnspacing="0.5em">${rows}</mtable>`;
}

/** Equation array: each m:e is a stacked row (aligned at relations). */
function eqArray(el: Element): string {
  const rows = childList(el, "m:e")
    .map((e) => `<mtr><mtd>${seq(e)}</mtd></mtr>`)
    .join("");
  return `<mtable columnalign="left" rowspacing="0.2em">${rows}</mtable>`;
}

/** Pre-sub/superscript (m:sPre): scripts attach before the base. */
function preScript(el: Element): string {
  const base = arg(child(el, "m:e"));
  const sub = arg(child(el, "m:sub"));
  const sup = arg(child(el, "m:sup"));
  return `<mmultiscripts>${base}<mprescripts/>${sub}${sup}</mmultiscripts>`;
}

function node(el: Element): string {
  switch (el.tagName) {
    case "m:r":
      return runToMathML(runText(el), runVariant(el));
    case "m:f":
      return fraction(el);
    case "m:sSup":
      return `<msup>${arg(child(el, "m:e"))}${arg(child(el, "m:sup"))}</msup>`;
    case "m:sSub":
      return `<msub>${arg(child(el, "m:e"))}${arg(child(el, "m:sub"))}</msub>`;
    case "m:sSubSup":
      return `<msubsup>${arg(child(el, "m:e"))}${arg(child(el, "m:sub"))}${arg(child(el, "m:sup"))}</msubsup>`;
    case "m:sPre":
      return preScript(el);
    case "m:rad":
      return radical(el);
    case "m:nary":
      return nary(el);
    case "m:d":
      return delimiter(el);
    case "m:func":
      return `<mrow>${arg(child(el, "m:fName"))}<mo>&#x2061;</mo>${arg(child(el, "m:e"))}</mrow>`;
    case "m:limLow":
      return `<munder>${arg(child(el, "m:e"))}${arg(child(el, "m:lim"))}</munder>`;
    case "m:limUpp":
      return `<mover>${arg(child(el, "m:e"))}${arg(child(el, "m:lim"))}</mover>`;
    case "m:groupChr":
      return groupChr(el);
    case "m:bar":
      return bar(el);
    case "m:acc":
      return accent(el);
    case "m:m":
      return matrix(el);
    case "m:eqArr":
      return eqArray(el);
    // Containers / wrappers: descend so nested content survives.
    case "m:e":
    case "m:box":
    case "m:borderBox":
    case "m:phant":
    case "m:num":
    case "m:den":
      return seq(el);
    // Property elements carry no rendered content.
    case "m:rPr":
    case "m:fPr":
    case "m:naryPr":
    case "m:dPr":
    case "m:radPr":
    case "m:barPr":
    case "m:accPr":
    case "m:groupChrPr":
    case "m:ctrlPr":
      return "";
    default:
      // Unknown element — recurse so we never silently drop text.
      return el.children.length ? seq(el) : "";
  }
}

/**
 * Convert an `m:oMath` or `m:oMathPara` element to a MathML string.
 * `display` selects block (true) vs inline (false) layout.
 */
export function ommlToMathml(el: Element, display: boolean): string {
  const mode = display ? "block" : "inline";
  // m:oMathPara wraps one or more m:oMath equations (display blocks).
  const maths = el.tagName === "m:oMathPara" ? childList(el, "m:oMath") : [el];
  return maths
    .map((m) => `<math xmlns="http://www.w3.org/1998/Math/MathML" display="${mode}">${seq(m)}</math>`)
    .join("");
}
