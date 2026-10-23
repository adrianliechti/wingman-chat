import { describe, expect, it } from "vitest";
import { bytesToDataUrl, dataUrlToBytes } from "@/shared/lib/fileContent";
import { runBash } from "./bashRuntime";

describe("Bash artifact runtime", () => {
  it("runs pipelines and syncs created, modified and deleted workspace files", async () => {
    const result = await runBash({
      code: 'cat input.txt | sort | uniq > output.txt; printf "changed" > existing.txt; rm obsolete.txt; pwd; echo "$HOME"',
      files: {
        "/input.txt": { content: "beta\nalpha\nbeta\n" },
        "/existing.txt": { content: "before" },
        "/obsolete.txt": { content: "delete" },
      },
    });
    expect(result.success, result.error).toBe(true);
    expect(result.output).toBe("/home/user\n/home/user");
    expect(result.files?.["/output.txt"].content).toBe("alpha\nbeta\n");
    expect(result.files?.["/existing.txt"].content).toBe("changed");
    expect(result.files?.["/obsolete.txt"]).toBeUndefined();
    expect(Object.keys(result.files ?? {})).toHaveLength(3);
  });

  it("invokes a mounted file with literal arguments, sources siblings and runs nested bash/sh scripts", async () => {
    const result = await runBash({
      code: "ignored when a script path is supplied",
      path: "/skills/example/scripts/run.sh",
      args: ["result with spaces.txt", "$(touch injected); 'quoted' *"],
      files: {
        "/skills/example/scripts/run.sh": {
          content:
            '#!/bin/bash\nsource "$(dirname "$0")/helper.sh"\nprintf "%s" "$2" > "$1"\nbash "$(dirname "$0")/child.sh" "$label"\nsh -c \'echo nested-sh\'',
        },
        "/skills/example/scripts/helper.sh": { content: 'label="adjacent resource"' },
        "/skills/example/scripts/child.sh": { content: 'printf "%s\\n" "$1"' },
      },
    });
    expect(result.success, result.error).toBe(true);
    expect(result.output).toBe("adjacent resource\nnested-sh");
    expect(result.files?.["/result with spaces.txt"].content).toBe("$(touch injected); 'quoted' *");
    expect(result.files?.["/injected"]).toBeUndefined();
  });

  it("passes inline arguments and preserves heredoc indentation", async () => {
    const result = await runBash({
      code: 'printf "%s\\n" "$1"; cat <<\'EOF\' > indented.txt\n  indented\nEOF',
      args: ["literal value"],
    });
    expect(result.success, result.error).toBe(true);
    expect(result.output).toBe("literal value");
    expect(result.files?.["/indented.txt"].content).toBe("  indented\n");
  });

  it("preserves unchanged encodings and metadata and round-trips binary outputs", async () => {
    const binary = {
      content: bytesToDataUrl(new Uint8Array([0, 255, 128, 65]), "image/png"),
      contentType: "image/png",
    };
    const text = { content: "\uFEFFhello\r\n", contentType: "text/plain;charset=utf-8" };
    const result = await runBash({
      code: "cp image.png copy.png; cat image.png > extensionless; printf /w== | base64 -d >> image.png; printf 'more' >> bom.txt",
      files: { "/image.png": binary, "/untouched.png": binary, "/bom.txt": text, "/untouched.txt": text },
    });
    expect(result.success, result.error).toBe(true);
    expect(result.files?.["/untouched.png"]).toEqual(binary);
    expect(result.files?.["/untouched.txt"]).toEqual(text);
    expect(result.files?.["/copy.png"]).toEqual(binary);
    expect([...dataUrlToBytes(result.files!["/extensionless"].content)!.bytes]).toEqual([0, 255, 128, 65]);
    expect([...dataUrlToBytes(result.files!["/image.png"].content)!.bytes]).toEqual([0, 255, 128, 65, 255]);
    expect(result.files?.["/bom.txt"]).toEqual({ ...text, content: "\uFEFFhello\r\nmore" });
  });

  it("returns diagnostics and no committable snapshot after a nonzero exit", async () => {
    const result = await runBash({
      code: "echo changed > discard.txt; echo progress; echo diagnostic >&2; exit 7",
    });
    expect(result.success).toBe(false);
    expect(result.output).toBe("progress\n");
    expect(result.error).toBe("Script exited with status 7\ndiagnostic\n");
    expect(result.files).toBeUndefined();
  });

  it("bounds output and rejects snapshots that exceed file limits", async () => {
    const output = await runBash({ code: "seq 1 1000", limits: { maxOutputBytes: 128 } });
    expect(output.success, output.error).toBe(true);
    expect(new TextEncoder().encode(output.output).length).toBeLessThanOrEqual(128);
    expect(output.output).toContain("truncated");
    const files = await runBash({ code: "touch one two", limits: { maxFiles: 1 } });
    expect(files.success).toBe(false);
    expect(files.error).toContain("more than 1 files");
    expect(files.files).toBeUndefined();
    const size = await runBash({ code: "printf 'too long' > file", limits: { maxFileBytes: 4 } });
    expect(size.success).toBe(false);
    expect(size.error).toContain("per-file limit");
  });

  it("starts with fresh shell state and filesystem and provides no host runtimes or network", async () => {
    expect((await runBash({ code: "export LEAK=yes; echo secret > secret.txt" })).success).toBe(true);
    const fresh = await runBash({ code: 'test ! -e secret.txt && test -z "$LEAK"' });
    expect(fresh.success, fresh.error).toBe(true);
    for (const command of ["python3", "node", "curl https://example.com"]) {
      const result = await runBash({ code: command });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/command not (?:found|available)/);
    }
  });
});
