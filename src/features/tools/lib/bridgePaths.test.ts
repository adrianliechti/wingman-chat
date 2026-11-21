import { describe, expect, it } from "vitest";
import { bridgeArtifactPath, bridgeInputPaths, bridgeOutputPath } from "./bridgePaths";

describe("bridge paths", () => {
  it.each([
    [" //./home//user/reports/./Q3 sales.pdf/ ", "/reports/Q3 sales.pdf"],
    ["sandbox://home//user/reports/Q3 sales.pdf#page=2", "/reports/Q3 sales.pdf"],
    ["artifact:/home/pyodide/reports/Q3 sales.pdf?preview=true", "/reports/Q3 sales.pdf"],
    ["/reports/Q3 #sales?.pdf", "/reports/Q3 #sales?.pdf"],
    ["/home/user-archive/Q3 sales.pdf", "/home/user-archive/Q3 sales.pdf"],
  ])("resolves %s to the artifact key %s", (input, expected) => {
    expect(bridgeArtifactPath(input)).toBe(expected);
  });

  it.each(["", "  ", "/", "//home//user/.", "sandbox:/", "artifact:/one/../two", "/bad\0name"])(
    "rejects the invalid artifact file reference %j",
    (input) => expect(() => bridgeArtifactPath(input)).toThrow(/file path/),
  );

  it("keeps explicit mounts, native reads, and the current working directory distinct", () => {
    expect(bridgeInputPaths("/tmp/song.mp3", "/home/user")).toEqual(["/tmp/song.mp3", "/home/user/tmp/song.mp3"]);
    expect(bridgeInputPaths("artifact:/tmp/song.mp3", "/home/user")).toEqual(["/home/user/tmp/song.mp3"]);
    expect(bridgeInputPaths("/home/pyodide/song.mp3", "/home/user")).toEqual([
      "/home/pyodide/song.mp3",
      "/home/user/song.mp3",
    ]);
    expect(bridgeInputPaths(" /home/user/data/scan.pdf ", "/tmp")).toEqual([
      "/tmp/ /home/user/data/scan.pdf ",
      "/home/user/data/scan.pdf",
    ]);
    expect(bridgeInputPaths("../data/scan.pdf", "/home/user/scripts")).toEqual(["/home/user/data/scan.pdf"]);
  });

  it.each([
    ["/nested/out.wav", "/home/user/scripts", "/home/user/nested/out.wav"],
    ["../nested/out.wav", "/home/user/scripts", "/home/user/nested/out.wav"],
    [" /home/user/nested/./out.wav ", "/tmp", "/home/user/nested/out.wav"],
    ["/home/pyodide/out.wav", "/home/user", "/home/user/out.wav"],
    ["/tmp/out.wav", "/home/user", "/tmp/out.wav"],
    ["out.wav", "/tmp", "/tmp/out.wav"],
    ["sandbox:/tmp/out.wav", "/tmp", "/home/user/tmp/out.wav"],
  ])("resolves output %s from %s to %s", (input, cwd, expected) => {
    expect(bridgeOutputPath(input, cwd)).toBe(expected);
  });

  it.each(["/home/user/", "/home/user/../../out.wav", "/tmp/../out.wav", "../../out.wav"])(
    "rejects output %s when it resolves outside its selected directory",
    (input) => expect(() => bridgeOutputPath(input, "/home/user")).toThrow(/Output path must name a file/),
  );
});
