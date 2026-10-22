import { afterEach, describe, expect, it, vi } from "vitest";
import { publishArtifacts, shareEntryFor, shareErrorMessage } from "./shareArtifacts";

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
