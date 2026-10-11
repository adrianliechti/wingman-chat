import { createElement, Fragment, useId, type CSSProperties, type ReactNode } from "react";
import type { BlockNode, InlineNode, ListItemNode } from "@tanstack/markdown";
import { parseMarkdown } from "@tanstack/markdown/parser";
import { cn } from "@/shared/lib/cn";
import { UiIcon } from "./UiIcon";

// The Basic Catalog names are semantic Material names, not Lucide names.
// Keep the complete mapping explicit so a catalog upgrade cannot silently
// turn a newly standardized icon into our unknown-icon fallback.
export const BASIC_ICONS = {
  accountCircle: "circle-user-round",
  add: "plus",
  arrowBack: "arrow-left",
  arrowForward: "arrow-right",
  attachFile: "paperclip",
  calendarToday: "calendar-days",
  call: "phone",
  camera: "camera",
  check: "check",
  close: "x",
  delete: "trash-2",
  download: "download",
  edit: "edit",
  event: "calendar",
  error: "circle-alert",
  fastForward: "fast-forward",
  favorite: "heart",
  favoriteOff: "heart-off",
  folder: "folder",
  help: "circle-help",
  home: "home",
  info: "info",
  locationOn: "map-pin",
  lock: "lock",
  lockOpen: "lock-open",
  mail: "mail",
  menu: "menu",
  moreVert: "ellipsis-vertical",
  moreHoriz: "ellipsis",
  notificationsOff: "bell-off",
  notifications: "bell",
  pause: "pause",
  payment: "credit-card",
  person: "user",
  phone: "phone",
  photo: "image",
  play: "play",
  print: "printer",
  refresh: "refresh-cw",
  rewind: "rewind",
  search: "search",
  send: "send",
  settings: "settings",
  share: "share",
  shoppingCart: "shopping-cart",
  skipNext: "skip-forward",
  skipPrevious: "skip-back",
  star: "star",
  starHalf: "star-half",
  starOff: "star-off",
  stop: "square",
  upload: "upload",
  visibility: "eye",
  visibilityOff: "eye-off",
  volumeDown: "volume-1",
  volumeMute: "volume",
  volumeOff: "volume-off",
  volumeUp: "volume-2",
  warning: "triangle-alert",
} as const;

export function BasicIcon({ name }: { name: unknown }) {
  if (name && typeof name === "object" && "svgPath" in name && typeof name.svgPath === "string") {
    return (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
        <path d={name.svgPath} />
      </svg>
    );
  }
  const mapped =
    typeof name === "string" && Object.hasOwn(BASIC_ICONS, name)
      ? BASIC_ICONS[name as keyof typeof BASIC_ICONS]
      : "circle-help";
  return <UiIcon name={mapped} size={20} />;
}

export function safeMediaUrl(value: unknown): string | undefined {
  return typeof value === "string" && /^(https?:\/\/|data:(image|audio|video)\/)/i.test(value) ? value : undefined;
}

const IMAGE_STYLES: Record<string, CSSProperties> = {
  icon: { width: "1.5rem", aspectRatio: "1" },
  avatar: { width: "3rem", aspectRatio: "1" },
  smallFeature: { width: "6rem", aspectRatio: "1" },
  mediumFeature: { width: "20rem", aspectRatio: "16 / 9" },
  largeFeature: { width: "30rem", aspectRatio: "16 / 9" },
  header: { width: "100%", aspectRatio: "3 / 1" },
};

export function BasicImage({
  url,
  description,
  variant,
  fit,
}: {
  url: unknown;
  description?: unknown;
  variant?: unknown;
  fit?: unknown;
}) {
  const imageVariant = typeof variant === "string" && Object.hasOwn(IMAGE_STYLES, variant) ? variant : "mediumFeature";
  const objectFit =
    fit === "scaleDown"
      ? "scale-down"
      : ["contain", "cover", "fill", "none"].includes(String(fit))
        ? (fit as CSSProperties["objectFit"])
        : "fill";
  return (
    <img
      src={safeMediaUrl(url)}
      alt={typeof description === "string" ? description : ""}
      loading="lazy"
      data-a2ui-image-variant={imageVariant}
      className={cn("block max-h-96 max-w-full", imageVariant === "avatar" ? "rounded-full" : "rounded-md")}
      style={{ ...IMAGE_STYLES[imageVariant], objectFit }}
    />
  );
}

function inline(nodes: InlineNode[]): ReactNode {
  return nodes.map((node, key) => {
    switch (node.type) {
      case "text":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "inlineCode":
        return (
          <code
            key={key}
            className="rounded-md border border-neutral-200/70 bg-neutral-100/80 px-1.5 py-0.5 font-mono text-[0.85em] dark:border-neutral-700/70 dark:bg-neutral-800"
          >
            {node.value}
          </code>
        );
      case "strong":
        return <strong key={key}>{inline(node.children)}</strong>;
      case "emphasis":
        return <em key={key}>{inline(node.children)}</em>;
      case "strike":
        return <s key={key}>{inline(node.children)}</s>;
      // Basic Text is intentionally noninteractive. Links keep their labels,
      // and image alternatives remain readable without creating media nodes.
      case "link":
        return <Fragment key={key}>{inline(node.children)}</Fragment>;
      case "image":
        return <Fragment key={key}>{node.alt}</Fragment>;
      case "break":
        return <br key={key} />;
      case "footnoteReference":
        return <sup key={key}>{node.number}</sup>;
      case "inlineHtml":
        return <Fragment key={key}>{node.value}</Fragment>;
      default:
        return null;
    }
  });
}

const headingClass = ["", "text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"];

function TaskItem({ item }: { item: ListItemNode }) {
  const id = useId();
  return (
    <li className="task-list-item">
      <input type="checkbox" className="task-checkbox" checked={item.checked} readOnly disabled aria-labelledby={id} />
      <div id={id} className="min-w-0 space-y-2">
        {blocks(item.children)}
      </div>
    </li>
  );
}

function blocks(nodes: BlockNode[]): ReactNode {
  return nodes.map((node, key) => {
    switch (node.type) {
      case "heading":
        return createElement(
          `h${node.depth}`,
          { key, className: cn("font-semibold leading-snug tracking-tight", headingClass[node.depth]) },
          inline(node.children),
        );
      case "paragraph":
        return (
          <p key={key} className="m-0">
            {inline(node.children)}
          </p>
        );
      case "code":
        return (
          <pre
            key={key}
            className="max-w-full overflow-x-auto rounded-lg border border-neutral-200/80 bg-neutral-50 p-3.5 font-mono text-xs leading-6 dark:border-neutral-800 dark:bg-neutral-900"
            tabIndex={0}
            aria-label="Code block"
          >
            <code>{node.value}</code>
          </pre>
        );
      case "list":
        return createElement(
          node.ordered ? "ol" : "ul",
          {
            key,
            start: node.ordered ? node.start : undefined,
            className: cn(
              "space-y-1.5 marker:text-neutral-400 dark:marker:text-neutral-500",
              node.items.some((item) => item.checked !== undefined)
                ? "task-list list-none"
                : cn("pl-5", node.ordered ? "list-decimal" : "list-disc"),
            ),
          },
          node.items.map((item, index) =>
            item.checked !== undefined ? (
              <TaskItem key={index} item={item} />
            ) : (
              <li key={index} className="space-y-1.5">
                {blocks(item.children)}
              </li>
            ),
          ),
        );
      case "blockquote":
        return (
          <blockquote
            key={key}
            className="space-y-2 border-l-[3px] border-neutral-300 py-0.5 pl-3.5 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
          >
            {blocks(node.children)}
          </blockquote>
        );
      case "table":
        return (
          <div
            key={key}
            className="max-w-full overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800"
            tabIndex={0}
            role="region"
            aria-label="Table"
          >
            <table className="w-full border-collapse text-sm leading-6">
              <thead className="bg-neutral-50 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                <tr>
                  {node.header.map((cell, i) => (
                    <th
                      key={i}
                      scope="col"
                      className="whitespace-nowrap border-b border-neutral-200 px-3 py-2 text-xs font-medium dark:border-neutral-800"
                      style={{ textAlign: node.align[i] ?? "left" }}
                    >
                      {inline(cell.children)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {node.rows.map((row, i) => (
                  <tr key={i} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className="px-3 py-2 align-top tabular-nums"
                        style={{ textAlign: node.align[j] ?? "left" }}
                      >
                        {inline(cell.children)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "thematicBreak":
        return <hr key={key} className="border-neutral-300 dark:border-neutral-700" />;
      case "footnotes":
        return (
          <ol key={key} className="list-decimal pl-5 text-xs">
            {node.items.map((item) => (
              <li key={item.id}>{blocks(item.children)}</li>
            ))}
          </ol>
        );
      case "html":
        return <Fragment key={key}>{node.value}</Fragment>;
      default:
        return null;
    }
  });
}

/** A2UI Text supports formatting, never the host's HTML, media or UI extensions. */
export function BasicText({ text, variant }: { text: string; variant?: unknown }) {
  let content: ReactNode;
  try {
    content = blocks(parseMarkdown(text, { allowHtml: false, headingIds: false, frontmatter: false }).children);
  } catch {
    content = text;
  }
  return (
    <div
      data-a2ui-text=""
      className={cn(
        "min-w-0 max-w-full leading-relaxed [overflow-wrap:anywhere] [&>*+*]:mt-3 [&>h1:not(:first-child)]:mt-6 [&>h2:not(:first-child)]:mt-5 [&>h3:not(:first-child)]:mt-4 [&_pre]:focus-visible:ring-2 [&_pre]:focus-visible:ring-neutral-400/50 [&_[role=region]]:focus-visible:ring-2 [&_[role=region]]:focus-visible:ring-neutral-400/50",
        variant === "caption" ? "text-xs text-neutral-500 dark:text-neutral-400" : "text-sm",
      )}
    >
      {content}
    </div>
  );
}

export type DateTimeInputType = "date" | "time" | "datetime-local" | "text";

export function dateTimeInputType(enableDate: unknown, enableTime: unknown): DateTimeInputType {
  return enableDate === true
    ? enableTime === true
      ? "datetime-local"
      : "date"
    : enableTime === true
      ? "time"
      : "text";
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;
const ZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/i;
const pad = (n: number, digits = 2) => String(n).padStart(digits, "0");

function localDateTime(date: Date): string {
  const day = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${day}T${time}${date.getMilliseconds() ? `.${pad(date.getMilliseconds(), 3)}` : ""}`;
}

/** Native controls use local wall time; zoned model timestamps represent instants. */
export function dateTimeInputValue(value: unknown, type: DateTimeInputType): string {
  if (typeof value !== "string" || !value) return "";
  if (type === "text") return value;
  let local = value;
  if (DATETIME.test(value)) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    local = ZONE.test(value) ? localDateTime(date) : value.replace("t", "T");
  }
  if (type === "date") return DATE.test(local) ? local : DATETIME.test(local) ? local.split("T")[0] : "";
  if (type === "time") {
    // A time without a date has no timezone conversion date (including DST).
    // Keep its wall time and preserve the supplied offset on writeback.
    const time = DATETIME.test(local) ? local.split("T")[1] : local.replace(ZONE, "");
    return TIME.test(time) ? time : "";
  }
  return DATETIME.test(local) ? local : DATE.test(local) ? `${local}T00:00` : "";
}

/** Partial pickers retain the hidden portion of an existing timestamp. */
export function dateTimeModelValue(value: string, previous: unknown, type: DateTimeInputType): string {
  if (!value || type === "text") return value;
  const original = typeof previous === "string" ? previous : "";
  const displayed = dateTimeInputValue(original, type);
  if (value === displayed) return original;
  // Browsers omit zero seconds. Preserve the original instant for unchanged
  // wall times, including the repeated hour at the end of daylight saving.
  if (
    type === "datetime-local" &&
    DATETIME.test(value) &&
    DATETIME.test(displayed) &&
    Date.parse(value) === Date.parse(displayed)
  )
    return original;
  if (
    type === "time" &&
    TIME.test(value) &&
    TIME.test(displayed) &&
    Date.parse(`1970-01-01T${value}`) === Date.parse(`1970-01-01T${displayed}`)
  )
    return original;
  const isDateTime = DATETIME.test(original);
  const zoned = isDateTime && ZONE.test(original);
  const local = dateTimeInputValue(original, "datetime-local");
  let next = value;
  if (isDateTime && type === "date") next = `${value}T${local.split("T")[1] ?? "00:00"}`;
  if (isDateTime && type === "time") next = `${local.split("T")[0]}T${value}`;
  if (zoned) {
    const date = new Date(next);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }
  if (type === "time" && !isDateTime) return `${value}${original.match(ZONE)?.[0] ?? ""}`;
  return next;
}
