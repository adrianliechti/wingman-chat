import { describe, expect, it } from "vitest";
import {
  asMp3,
  composeSongPrompt,
  formatTime,
  insertSectionTag,
  songColors,
  songPoster,
  waveformPeaks,
  WAVEFORM_BARS,
} from "./song";

const draft = { description: "", mode: "describe", lyrics: "", durationSeconds: null } as const;

describe("song prompt", () => {
  it("sends a description as it is when the model writes the lyrics", () => {
    expect(composeSongPrompt({ ...draft, description: "  Dreamy indie pop at 122 BPM  ", lyrics: "unused" })).toBe(
      "Dreamy indie pop at 122 BPM",
    );
  });

  it("puts the user's lyrics beneath a Lyrics header, after the direction and length", () => {
    expect(
      composeSongPrompt({
        description: "Warm folk ballad",
        mode: "lyrics",
        lyrics: "[Verse]\nWalking home\n\n[Chorus]\nWe keep moving on\n",
        durationSeconds: 120,
      }),
    ).toBe(
      "Warm folk ballad\n\nLength: about 2 minutes.\n\nLyrics:\n\n[Verse]\nWalking home\n\n[Chorus]\nWe keep moving on",
    );
  });

  it("asks for an instrumental in words and leaves typed lyrics out", () => {
    expect(
      composeSongPrompt({ description: "Lo-fi beat", mode: "instrumental", lyrics: "[Verse] la", durationSeconds: 30 }),
    ).toBe("Lo-fi beat\n\nLength: about 30 seconds. Instrumental only, no vocals.");
  });

  it("accepts lyrics without a description", () => {
    expect(composeSongPrompt({ ...draft, mode: "lyrics", lyrics: "[Chorus]\nOne line", durationSeconds: 60 })).toBe(
      "Length: about 1 minute.\n\nLyrics:\n\n[Chorus]\nOne line",
    );
  });
});

describe("section tags", () => {
  it("starts empty lyrics with the tag and puts the cursor on the next line", () => {
    expect(insertSectionTag("", 0, "Verse")).toEqual({ text: "[Verse]\n", cursor: 8 });
  });

  it("separates a new section from the one before it by one blank line", () => {
    for (const before of ["Walking home", "Walking home\n", "Walking home\n\n"]) {
      const next = insertSectionTag(before, before.length, "Chorus");
      expect(next.text).toBe("Walking home\n\n[Chorus]\n");
      expect(next.cursor).toBe(next.text.length);
    }
  });

  it("inserts at the cursor and keeps the text after it", () => {
    const text = "[Verse]\nOne\nTwo";
    const next = insertSectionTag(text, text.indexOf("\nTwo"), "Bridge");
    expect(next.text).toBe("[Verse]\nOne\n\n[Bridge]\nTwo");
    expect(next.text.slice(next.cursor)).toBe("Two");
  });
});

describe("waveform", () => {
  it("scales the loudness of each bar to the loudest one across channels", () => {
    const quiet = new Float32Array(400).fill(0.1);
    const left = new Float32Array(800);
    left.set(quiet, 0);
    left.set(new Float32Array(400).fill(0.5), 400);
    expect(waveformPeaks([left, left], 2)).toEqual([0.2, 1]);
    expect(waveformPeaks([left])).toHaveLength(WAVEFORM_BARS);
  });

  it("reports silence and missing audio without dividing by zero", () => {
    expect(waveformPeaks([new Float32Array(10)], 2)).toEqual([0, 0]);
    expect(waveformPeaks([])).toEqual([]);
  });
});

describe("song cover", () => {
  const decode = (poster: string) => atob(poster.replace("data:image/svg+xml;base64,", ""));

  it("draws the same cover for the same song and different colors for another", () => {
    const peaks = [0.2, 0.9, 0.5];
    expect(songPoster(peaks, "Warm folk ballad")).toBe(songPoster(peaks, "Warm folk ballad"));
    expect(songColors("Warm folk ballad")).not.toEqual(songColors("Lo-fi beat"));
    const svg = decode(songPoster(peaks, "Warm folk ballad"));
    expect(svg).toContain(songColors("Warm folk ballad")[0]);
    expect(svg.match(/<rect /g)).toHaveLength(25);
  });

  it("still draws a cover when the waveform is unknown", () => {
    expect(decode(songPoster([], "Lo-fi beat"))).toContain("<svg");
  });
});

it("formats playback time and an unknown length", () => {
  expect(formatTime(7.9)).toBe("0:07");
  expect(formatTime(161)).toBe("2:41");
  expect(formatTime(undefined)).toBe("–:––");
  expect(formatTime(Number.POSITIVE_INFINITY)).toBe("–:––");
});

it("accepts the gateway's MP3 under either type and nothing else", () => {
  expect(asMp3(new Blob(["x"], { type: "audio/mpeg" }))?.type).toBe("audio/mpeg");
  expect(asMp3(new Blob(["x"], { type: "audio/mp3" }))?.type).toBe("audio/mpeg");
  expect(asMp3(new Blob(["x"], { type: "audio/wav" }))).toBeNull();
  expect(asMp3(new Blob(["{}"], { type: "application/json" }))).toBeNull();
});
