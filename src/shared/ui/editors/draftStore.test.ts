import { describe, expect, it } from "vitest";
import { allowDrafts, draftKey, dropDraft, dropDrafts, getDraft, moveDrafts, putDraft } from "./draftStore";

const draft = (text: string) => ({ text, base: "base" });

describe("draftStore", () => {
  it("keeps a file's draft until it is dropped", () => {
    const key = draftKey("keep", "/a.md");
    putDraft(key, draft("one"));
    putDraft(key, draft("two"));
    expect(getDraft(key)?.text).toBe("two");
    dropDraft(key);
    expect(getDraft(key)).toBeUndefined();
  });

  it("moves drafts with a renamed file or folder", () => {
    putDraft(draftKey("move", "/docs/a.md"), draft("a"));
    putDraft(draftKey("move", "/docs/sub/b.md"), draft("b"));
    putDraft(draftKey("move", "/docsx.md"), draft("x"));
    moveDrafts("move", "/docs", "/docs/archive");
    expect(getDraft(draftKey("move", "/docs/archive/a.md"))?.text).toBe("a");
    expect(getDraft(draftKey("move", "/docs/archive/sub/b.md"))?.text).toBe("b");
    expect(getDraft(draftKey("move", "/docs/a.md"))).toBeUndefined();
    expect(getDraft(draftKey("move", "/docsx.md"))?.text).toBe("x");
  });

  it("drops a deleted file's drafts and refuses new ones until the path is created again", () => {
    const key = draftKey("delete", "/folder/a.md");
    putDraft(key, draft("a"));
    dropDrafts("delete", "/folder");
    expect(getDraft(key)).toBeUndefined();
    putDraft(key, draft("closing editor"));
    expect(getDraft(key)).toBeUndefined();
    allowDrafts("delete", "/folder/a.md");
    putDraft(key, draft("new file"));
    expect(getDraft(key)?.text).toBe("new file");
  });

  it("keeps chats apart", () => {
    putDraft(draftKey("one", "/a.md"), draft("one"));
    dropDrafts("two", "/a.md");
    expect(getDraft(draftKey("one", "/a.md"))?.text).toBe("one");
  });
});
