import DOMPurify, { type Config } from "dompurify";
import { type CSSProperties, createElement, type ReactNode } from "react";

const ATTRIBUTE_NAME_MAP: Record<string, string> = {
  class: "className",
  colspan: "colSpan",
  crossorigin: "crossOrigin",
  for: "htmlFor",
  maxlength: "maxLength",
  readonly: "readOnly",
  referrerpolicy: "referrerPolicy",
  rowspan: "rowSpan",
  tabindex: "tabIndex",
};

function toCamelCase(property: string): string {
  if (property.startsWith("--")) {
    return property;
  }

  return property.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function parseStyle(styleValue: string): CSSProperties {
  const style: Record<string, string> = {};

  for (const declaration of styleValue.split(";")) {
    const separatorIndex = declaration.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const property = declaration.slice(0, separatorIndex).trim();
    const value = declaration.slice(separatorIndex + 1).trim();
    if (!property || !value) {
      continue;
    }

    style[toCamelCase(property)] = value;
  }

  return style as CSSProperties;
}

function getAttributeValue(attributeName: string, value: string): string | number | CSSProperties {
  if (attributeName === "style") {
    return parseStyle(value);
  }

  if (["colSpan", "maxLength", "rowSpan", "tabIndex"].includes(attributeName)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? value : parsed;
  }

  return value;
}

function htmlNodeToReact(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  const props: Record<string, unknown> = { key };

  for (const attribute of Array.from(element.attributes)) {
    const attributeName = ATTRIBUTE_NAME_MAP[attribute.name] ?? attribute.name;
    props[attributeName] = getAttributeValue(attributeName, attribute.value);
  }

  if (tagName === "a") {
    props.rel = element.getAttribute("rel") ?? "noreferrer";
    props.target = element.getAttribute("target") ?? "_blank";
  }

  const children = Array.from(element.childNodes).map((child, index) => htmlNodeToReact(child, `${key}-${index}`));
  return createElement(tagName, props, ...children);
}

export function sanitizeHtmlToReact(html: string, options: { keyPrefix?: string; config?: Config } = {}): ReactNode[] {
  if (typeof DOMParser === "undefined") {
    return [html];
  }

  const { keyPrefix = "html", config } = options;
  const sanitized = String(DOMPurify.sanitize(html, { ...config, RETURN_TRUSTED_TYPE: false }));

  if (!sanitized.trim()) {
    return [];
  }

  const parsed = new DOMParser().parseFromString(`<div>${sanitized}</div>`, "text/html");
  const root = parsed.body.firstElementChild;

  if (!root) {
    return [sanitized];
  }

  return Array.from(root.childNodes).map((node, index) => htmlNodeToReact(node, `${keyPrefix}-${index}`));
}
