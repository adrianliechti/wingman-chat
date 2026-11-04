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

function Harness() {
  editor = useEditor(image, update);
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
