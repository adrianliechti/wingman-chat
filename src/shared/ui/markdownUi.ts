import type { BlockNode, MarkdownExtension } from "@tanstack/markdown";
import { UI_FENCE_LANGUAGES } from "@/shared/lib/intelligentUi/schema";

export const UI_TAG = "md-ui";

/** Assign UI fences an ordinal within their owning Markdown message part. */
export const uiFenceExtension: MarkdownExtension = {
  name: "intelligent-ui",
  transformDocument(document) {
    let blockIndex = 0;
    const visit = (nodes: BlockNode[]): BlockNode[] =>
      nodes.map((node) => {
        if (node.type === "code" && UI_FENCE_LANGUAGES.has(node.lang?.toLowerCase() ?? "")) {
          return {
            type: "component",
            name: "intelligent-ui",
            tagName: UI_TAG,
            attributes: {},
            properties: { source: node.value, blockIndex: String(blockIndex++) },
            children: [],
          };
        }
        if (node.type === "list" || node.type === "footnotes") {
          return {
            ...node,
            items: node.items.map((item) => ({ ...item, children: visit(item.children) })),
          } as BlockNode;
        }
        if (node.type === "blockquote" || node.type === "callout" || node.type === "component") {
          return { ...node, children: visit(node.children) };
        }
        return node;
      });
    return { ...document, children: visit(document.children) };
  },
};
