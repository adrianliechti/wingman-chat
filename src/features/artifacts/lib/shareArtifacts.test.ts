import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listShares,
  publishArtifacts,
  recentShare,
  rememberShare,
  revokeShare,
  shareEntryFor,
  shareErrorMessage,
} from "./shareArtifacts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shareEntryFor", () => {
  const paths = ["/data/sales.csv", "/reports/q3.html", "/b.html", "/a.htm", "/index.html"];

  it("opens the page being viewed", () => {
    expect(shareEntryFor(paths, "/reports/q3.html")).toBe("/reports/q3.html");
  });

  it("falls back to the root index, then the shallowest page", () => {
    expect(shareEntryFor(paths, "/data/sales.csv")).toBe("/index.html");
    expect(shareEntryFor(paths.slice(0, 4), null)).toBe("/a.htm");
    expect(shareEntryFor(["/x/deep.html", "/x/y/deeper.html"])).toBe("/x/deep.html");
  });

  it("ignores an active page that is not in the workspace and workspaces without pages", () => {
    expect(shareEntryFor(["/index.html"], "/gone.html")).toBe("/index.html");
    expect(shareEntryFor(["/notes.md", "/data.csv"], "/notes.md")).toBeUndefined();
  });
});

describe("shareErrorMessage", () => {
  it("shows the server's plain-text reason as a sentence", () => {
    expect(shareErrorMessage(413, "text/plain; charset=utf-8", "the workspace exceeds the share size limit\n")).toBe(
      "The workspace exceeds the share size limit.",
    );
  });

  it("does not show a proxy's HTML error page", () => {
    expect(shareErrorMessage(413, "text/html", "<html><body>413 Request Entity Too Large</body></html>")).toBe(
      "The workspace is too large to share.",
    );
    expect(shareErrorMessage(502, "text/html", "<html>Bad gateway</html>")).toBe("Sharing failed (502).");
  });
});

describe("publishArtifacts", () => {
  it("uploads the folder export without libraries and returns an absolute link", async () => {
    const archive = new Blob(["zip"]);
    const exportZip = vi.fn(async () => archive);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "abc",
            url: "/artifacts/abc/",
            entry: "reports/q3 final.html",
            expiresAt: "2026-10-29T12:00:00Z",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { origin: "https://chat.example.com" } });

    const share = await publishArtifacts({ exportZip }, "/reports/q3 final.html");

    expect(exportZip).toHaveBeenCalledWith({ libraries: false, compression: "DEFLATE" });
    expect(fetchMock).toHaveBeenCalledWith("/artifacts?entry=reports%2Fq3%20final.html", {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: archive,
      signal: undefined,
    });
    expect(share).toEqual({
      id: "abc",
      url: "https://chat.example.com/artifacts/abc/",
      entry: "reports/q3 final.html",
      expiresAt: "2026-10-29T12:00:00Z",
    });
  });

  it("rejects with the server's reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("the entry page index.html is not in the upload\n", {
            status: 400,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      ),
    );

    await expect(publishArtifacts({ exportZip: async () => new Blob() }, "/index.html")).rejects.toThrow(
      "The entry page index.html is not in the upload.",
    );
  });
});

describe("listShares", () => {
  const listed = {
    id: "abc",
    url: "/artifacts/abc",
    title: "Q3 deck",
    entry: "index.html",
    files: 3,
    size: 2048,
    created: "2026-10-22T12:00:00Z",
    expiresAt: "2026-10-29T12:00:00Z",
  };

  it("returns the user's shares with absolute links", async () => {
    const fetchMock = vi.fn(async () => Response.json([listed]));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { origin: "https://chat.example.com" } });

    expect(await listShares()).toEqual([{ ...listed, url: "https://chat.example.com/artifacts/abc" }]);
    expect(fetchMock).toHaveBeenCalledWith("/artifacts", { cache: "no-store", signal: undefined });
  });

  it("is null when the server keeps no list per user, and fails on other errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("shares are listed per signed-in user\n", { status: 403 })),
    );
    expect(await listShares()).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })),
    );
    await expect(listShares()).rejects.toThrow("The shared links could not be loaded (502).");
  });
});

describe("revokeShare", () => {
  const share = { id: "abc", url: "https://chat.example.com/artifacts/abc", entry: "index.html" };
  const live = { ...share, expiresAt: "2026-10-29T12:00:00Z" };
  const now = Date.parse("2026-10-22T12:00:00Z");

  it("deletes the share and forgets the workspace's remembered link", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    rememberShare("chat-1", live);
    rememberShare("chat-2", { ...live, id: "other" });

    await revokeShare("abc");

    expect(fetchMock).toHaveBeenCalledWith("/artifacts/abc", { method: "DELETE" });
    expect(recentShare("chat-1", now)).toBeUndefined();
    expect(recentShare("chat-2", now)?.id).toBe("other");
  });

  it("treats a share that is already gone as revoked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("404 page not found\n", { status: 404 })),
    );
    rememberShare("chat-1", live);

    await revokeShare("abc");

    expect(recentShare("chat-1", now)).toBeUndefined();
  });

  it("keeps the link and reports why when the server refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("the share was published by someone else\n", {
            status: 403,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      ),
    );
    rememberShare("chat-1", live);

    await expect(revokeShare("abc")).rejects.toThrow("The share was published by someone else.");
    expect(recentShare("chat-1", now)?.id).toBe("abc");

    // A proxy's own error page is not shown to the user.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }),
      ),
    );
    await expect(revokeShare("abc")).rejects.toThrow("Revoking failed (502).");
  });
});

describe("recentShare", () => {
  it("returns a workspace's remembered link until it expires", () => {
    const share = {
      id: "abc",
      url: "https://chat.example.com/artifacts/abc",
      entry: "index.html",
      expiresAt: "2026-10-29T12:00:00Z",
    };
    rememberShare("chat-9", share);

    expect(recentShare("chat-9", Date.parse("2026-10-29T11:59:59Z"))).toEqual(share);
    expect(recentShare("another-chat", Date.parse("2026-10-22T12:00:00Z"))).toBeUndefined();
    expect(recentShare("chat-9", Date.parse("2026-10-29T12:00:00Z"))).toBeUndefined();
    // Expired links are dropped, not hidden.
    expect(recentShare("chat-9", Date.parse("2026-10-22T12:00:00Z"))).toBeUndefined();
  });
});
