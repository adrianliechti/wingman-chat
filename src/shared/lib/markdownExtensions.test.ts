import { renderHtml } from "@tanstack/markdown/html";
import { parseMarkdown } from "@tanstack/markdown/parser";
import { describe, expect, it } from "vitest";
import {
  hideUnfinishedLink,
  markdownExtensions,
  markdownUrlTransform,
  MATH_TAG,
  normalizeMathAliases,
} from "./markdownExtensions";

const options = { extensions: markdownExtensions("monochrome"), headingIds: false, urlTransform: markdownUrlTransform };
const html = (source: string) => renderHtml(normalizeMathAliases(source), options).trim();
const spans = (source: string) =>
  [...html(source).matchAll(/<span class="noto-emoji">([^<]*)<\/span>/g)].map((m) => m[1]);

describe("autolinks", () => {
  it("links bare addresses and leaves punctuation outside", () => {
    expect(html("see https://example.com/a_(b). and www.foo.org, ok")).toBe(
      '<p>see <a href="https://example.com/a_(b)">https://example.com/a_(b)</a>. and <a href="http://www.foo.org">www.foo.org</a>, ok</p>',
    );
    expect(html("[named](https://example.com) and `https://code.example`")).toContain(">named</a>");
    expect(html("x@https://not.a.link")).not.toContain("<a");
  });
});

describe("breaks", () => {
  it("turns a single newline into a line break", () => {
    expect(html("line one\nline two")).toBe("<p>line one<br>line two</p>");
    expect(html("**bold\nstill**")).toBe("<p><strong>bold<br>still</strong></p>");
  });
});

describe("math", () => {
  it("parses display and inline math and leaves unfinished math literal", () => {
    const doc = parseMarkdown(
      normalizeMathAliases("$$\nE = mc^2\n$$\n\nAlso \\(x^2\\) and $$y$$ and \\[\nz\n\\] here"),
      options,
    );
    const kinds = doc.children.map((block) => JSON.stringify(block).includes(MATH_TAG));
    expect(kinds).toEqual([true, true]);
    expect(JSON.stringify(doc.children[1]).match(/"name":"math"/g)).toHaveLength(3);
    expect(html("$$x^2$$")).toContain(`<${MATH_TAG}`);
    expect(html("costs $$5 and $$10")).toContain('source="5 and"');
    expect(html("unfinished \\(x")).toBe("<p>unfinished (x</p>");
    expect(html("`$$ literal $$`")).toBe("<p><code>$$ literal $$</code></p>");
  });
});

describe("normalizeMathAliases", () => {
  it("rewrites aliases outside code and keeps escapes and unfinished math", () => {
    expect(normalizeMathAliases("\\(x\\) `\\(literal\\)` \\[y\\]")).toBe("$$x$$ `\\(literal\\)` $$y$$");
    expect(normalizeMathAliases("\\\\(literal\\\\) and \\(unfinished")).toBe("\\\\(literal\\\\) and \\(unfinished");
    expect(normalizeMathAliases("```text\n\\(x\\)\n```")).toBe("```text\n\\(x\\)\n```");
    expect(normalizeMathAliases("\\[\nz\n\\]")).toBe("$$\nz\n$$");
  });
});

describe("emoji", () => {
  it("expands shortcodes and wraps every emoji sequence exactly once", () => {
    expect(spans(":smile: ok :nope:")).toEqual(["😄"]);
    expect(html(":nope:")).toBe("<p>:nope:</p>");
    const emojis = ["😀", "❤️", "☀️", "🗺️", "👩🏽‍💻", "🏳️‍🌈", "🇨🇭", "1️⃣", "❤️‍🔥"];
    expect(spans(`Hello ${emojis.join(" ")}`)).toEqual(emojis.map((value) => value.replaceAll("\uFE0F", "")));
    expect(spans("**😀** [🏁](https://x.org)")).toEqual(["😀", "🏁"]);
  });

  it("keeps code untouched and keeps selectors in native mode", () => {
    expect(spans(":smile: `:smile: 😀`\n\n```text\n:smile: 😀\n```")).toEqual(["😄"]);
    const native = renderHtml("❤️ ☀️", { extensions: markdownExtensions("native") });
    expect([...native.matchAll(/<span class="noto-emoji">([^<]*)<\/span>/g)].map((m) => m[1])).toEqual(["❤️", "☀️"]);
  });
});

describe("workspace links", () => {
  it("keeps sandbox links and drops executable ones", () => {
    expect(html("[report](sandbox:/report.md)")).toContain('href="sandbox:/report.md"');
    expect(html("[x](javascript:alert(1))")).not.toContain("javascript");
  });
});

describe("hideUnfinishedLink", () => {
  it.each([
    ["See [label](https://example", "See label"],
    ["See ![image](https://example", "See image"],
    ["See [**label**](https://example", "See **label**"],
    ["See [label `code`](https://example", "See label `code`"],
    ["[brackets] then [label](https://example", "[brackets] then label"],
    ["See [outer [inner]](https://example", "See outer [inner]"],
    ["`unfinished [label](https://example", "`unfinished label"],
    ["Para one\n\nSee [label](https://exa", "Para one\n\nSee label"],
  ])("stabilizes %s", (source, expected) => {
    expect(hideUnfinishedLink(source)).toBe(expected);
  });

  it.each([
    "[label](https://example.com/a_(b))",
    "[label](https://example.com/a\\))",
    '[label](https://example.com "title (with brackets)")',
    "\\[literal](unfinished",
    "[label\\](unfinished",
    "```text\n[label](unfinished",
    "[label](unfinished\n\nAnother paragraph",
  ])("preserves complete or literal links: %s", (source) => {
    expect(hideUnfinishedLink(source)).toBe(source);
  });
});
