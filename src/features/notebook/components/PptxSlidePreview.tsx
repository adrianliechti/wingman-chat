import { useMemo } from "react";

interface PptxSlidePreviewProps {
  xml: string;
  className?: string;
}

// Slide is 9144000 x 5143500 EMU, rendered at 960 x 540 px
const SLIDE_W = 9144000;
const SLIDE_H = 5143500;
const PX_W = 960;
const PX_H = 540;

function emuToPxX(emu: number): number {
  return (emu / SLIDE_W) * PX_W;
}
function emuToPxY(emu: number): number {
  return (emu / SLIDE_H) * PX_H;
}

export function PptxSlidePreview({ xml, className = "" }: PptxSlidePreviewProps) {
  const elements = useMemo(() => parseSlideXml(xml), [xml]);

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ width: PX_W, height: PX_H, backgroundColor: elements.bgColor }}
    >
      {elements.shapes.map((el, i) => (
        <ShapeRenderer key={i} shape={el} />
      ))}
    </div>
  );
}

interface ParsedSlide {
  bgColor: string;
  shapes: ParsedShape[];
}

interface ParsedShape {
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  texts: ParsedText[];
  isTextBox: boolean;
}

interface ParsedText {
  text: string;
  bold: boolean;
  italic: boolean;
  fontSize: number;
  color: string;
  align: string;
  fontFace?: string;
  bullet?: string;
}

function parseSlideXml(xml: string): ParsedSlide {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  if (doc.querySelector("parsererror")) {
    return { bgColor: "#FFFFFF", shapes: [] };
  }

  // Background color
  let bgColor = "#FFFFFF";
  const bgFill = doc.querySelector("bg bgPr solidFill srgbClr, bg bgPr solidFill srgbClr");
  if (bgFill) {
    bgColor = `#${bgFill.getAttribute("val") || "FFFFFF"}`;
  }
  // Also try gradient first stop
  const bgGrad = doc.querySelector("bg bgPr gradFill gsLst gs srgbClr");
  if (bgGrad && !bgFill) {
    bgColor = `#${bgGrad.getAttribute("val") || "FFFFFF"}`;
  }

  // Parse shapes
  const shapes: ParsedShape[] = [];
  const spElements = doc.querySelectorAll("sp");

  for (const sp of spElements) {
    const off = sp.querySelector("spPr xfrm off");
    const ext = sp.querySelector("spPr xfrm ext");
    if (!off || !ext) continue;

    const x = emuToPxX(parseInt(off.getAttribute("x") || "0", 10));
    const y = emuToPxY(parseInt(off.getAttribute("y") || "0", 10));
    const w = emuToPxX(parseInt(ext.getAttribute("cx") || "0", 10));
    const h = emuToPxY(parseInt(ext.getAttribute("cy") || "0", 10));

    // Fill color
    let fill: string | undefined;
    const solidFill = sp.querySelector("spPr solidFill srgbClr");
    if (solidFill) {
      fill = `#${solidFill.getAttribute("val")}`;
    }
    const gradFill = sp.querySelector("spPr gradFill gsLst gs srgbClr");
    if (gradFill && !fill) {
      fill = `#${gradFill.getAttribute("val")}`;
    }

    // Check if text box
    const isTextBox = !!sp.querySelector("txBody");
    const noFill = sp.querySelector("spPr noFill");

    // Parse text content
    const texts: ParsedText[] = [];
    const paragraphs = sp.querySelectorAll("txBody p");
    for (const p of paragraphs) {
      const pPr = p.querySelector("pPr");
      const align = pPr?.getAttribute("algn") || "l";
      const bullet = p.querySelector("pPr buChar");
      const bulletChar = bullet?.getAttribute("char");

      const runs = p.querySelectorAll("r");
      for (const r of runs) {
        const rPr = r.querySelector("rPr");
        const t = r.querySelector("t");
        if (!t?.textContent) continue;

        const sz = parseInt(rPr?.getAttribute("sz") || "1800", 10);
        const bold = rPr?.getAttribute("b") === "1";
        const italic = rPr?.getAttribute("i") === "1";
        let color = "#333333";
        const colorEl = rPr?.querySelector("solidFill srgbClr");
        if (colorEl) color = `#${colorEl.getAttribute("val")}`;

        const latin = rPr?.querySelector("latin");
        const fontFace = latin?.getAttribute("typeface") || undefined;

        texts.push({
          text: t.textContent,
          bold,
          italic,
          fontSize: sz / 100, // convert to pt
          color,
          align: align === "ctr" ? "center" : align === "r" ? "right" : "left",
          fontFace,
          bullet: bulletChar || undefined,
        });
      }
    }

    // Only render if it has visible content
    if (texts.length > 0 || (fill && !noFill)) {
      shapes.push({ x, y, w, h, fill: noFill ? undefined : fill, texts, isTextBox });
    }
  }

  return { bgColor, shapes };
}

function ShapeRenderer({ shape }: { shape: ParsedShape }) {
  const style: React.CSSProperties = {
    position: "absolute",
    left: shape.x,
    top: shape.y,
    width: shape.w,
    height: shape.h,
    backgroundColor: shape.isTextBox ? undefined : shape.fill,
    overflow: "hidden",
  };

  if (shape.texts.length === 0) {
    return <div style={style} />;
  }

  return (
    <div style={style}>
      {shape.texts.map((t, i) => (
        <div
          key={i}
          style={{
            fontSize: t.fontSize * 0.75, // pt to px approximation
            fontWeight: t.bold ? "bold" : "normal",
            fontStyle: t.italic ? "italic" : "normal",
            color: t.color,
            textAlign: t.align as "left" | "center" | "right",
            fontFamily: t.fontFace || "Calibri, Arial, sans-serif",
            lineHeight: 1.3,
            paddingLeft: t.bullet ? 16 : 0,
            position: "relative",
          }}
        >
          {t.bullet && (
            <span style={{ position: "absolute", left: 0 }}>{t.bullet}</span>
          )}
          {t.text}
        </div>
      ))}
    </div>
  );
}
