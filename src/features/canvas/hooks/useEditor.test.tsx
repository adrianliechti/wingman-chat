// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEditor, type EditorHandle } from "./useEditor";
import { DEFAULTS } from "../lib/recipe";
import type { Image } from "../types/canvas";

let root: Root;
let container: HTMLDivElement;
let editor: EditorHandle;
const update = vi.fn();
const image: Image = {
  id: "photo",
  created: null,
  updated: null,
  model: "",
  prompt: "",
  data: "",
  versions: [],
  recipe: DEFAULTS,
};

function Harness({ source = image }: { source?: Image }) {
  editor = useEditor(source, update);
  return null;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  update.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("keeps separate undo steps for actions batched before a render", async () => {
  await act(async () => {
    editor.apply({ exposure: 1 });
    editor.apply({ exposure: 2 });
  });
  expect(editor.recipe.exposure).toBe(2);
  await act(async () => editor.undo());
  expect(editor.recipe.exposure).toBe(1);
  await act(async () => editor.undo());
  expect(editor.recipe.exposure).toBe(0);
  await act(async () => editor.redo());
  expect(editor.recipe.exposure).toBe(1);
});

it("coalesces a drag into one undo step and ignores duplicate commits", async () => {
  await act(async () => editor.change({ exposure: 1 }));
  await act(async () => editor.change({ exposure: 2 }));
  await act(async () => {
    editor.commit();
    editor.commit();
  });
  await act(async () => editor.undo());
  expect(editor.recipe.exposure).toBe(0);
  expect(editor.canUndo).toBe(false);
  await act(async () => editor.redo());
  expect(editor.recipe.exposure).toBe(2);
});

it("publishes a live edit before the keyed editor can unmount", async () => {
  await act(async () => editor.change({ exposure: 1.5 }));
  expect(update).toHaveBeenCalledTimes(1);
  const [id, updater] = update.mock.calls[0];
  expect(id).toBe(image.id);
  expect(updater(image).recipe.exposure).toBe(1.5);
});

it("undoes an unfinished edit and invalidates redo after a new committed change", async () => {
  await act(async () => editor.apply({ exposure: 1 }));
  await act(async () => editor.change({ exposure: 2 }));
  await act(async () => editor.undo());
  expect(editor.recipe.exposure).toBe(1);
  expect(editor.canRedo).toBe(true);
  await act(async () => editor.change({ exposure: 3 }));
  expect(editor.canRedo).toBe(false);
  await act(async () => editor.commit());
  await act(async () => editor.redo());
  expect(editor.recipe.exposure).toBe(3);
  await act(async () => editor.undo());
  expect(editor.recipe.exposure).toBe(1);
});

it("starts a fresh undo history when a new pixel version replaces the source", async () => {
  await act(async () => editor.apply({ exposure: 1.5 }));
  const publishOldRecipe = update.mock.calls.at(-1)![1];
  // Identical bytes can still be a new version (e.g. an identity crop flattened).
  const flattened: Image = { ...image, versions: [{ id: "flattened", kind: "flatten", created: "2026-01-01" }] };
  expect(publishOldRecipe(flattened)).toBe(flattened);
  await act(async () =>
    root.render(
      <StrictMode>
        <Harness source={flattened} />
      </StrictMode>,
    ),
  );
  expect(editor.recipe).toEqual(DEFAULTS);
  expect(editor.canUndo).toBe(false);
  await act(async () => editor.undo());
  expect(editor.recipe).toEqual(DEFAULTS);
  await act(async () => editor.apply({ exposure: 0.5 }));
  await act(async () => editor.undo());
  expect(editor.recipe.exposure).toBe(0);
});

it("restores settings on the same pixel version without publishing the old recipe back", async () => {
  await act(async () => editor.apply({ exposure: 1.5 }));
  const edited: Image = { ...image, recipe: editor.recipe };
  // The collection echoes our own edit without resetting its undo history.
  await act(async () =>
    root.render(
      <StrictMode>
        <Harness source={edited} />
      </StrictMode>,
    ),
  );
  expect(editor.canUndo).toBe(true);
  update.mockClear();
  await act(async () =>
    root.render(
      <StrictMode>
        <Harness source={image} />
      </StrictMode>,
    ),
  );
  expect(editor.recipe).toEqual(DEFAULTS);
  expect(editor.canUndo).toBe(false);
  expect(update).not.toHaveBeenCalled();
  await act(async () => editor.apply({ exposure: 0.5 }));
  expect(update).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0][1](image).recipe.exposure).toBe(0.5);
});
