/**
 * How a song is asked for: described and left to the model, sung to the
 * user's own lyrics, or without vocals.
 */
export type SongMode = "describe" | "lyrics" | "instrumental";

export interface SongDraft {
  mode: SongMode;
  /** The song in words; with own lyrics it is their musical style. */
  description: string;
  /** The user's own lyrics; sung only when `mode` is "lyrics". */
  lyrics: string;
  durationSeconds: number | null;
}

/** The modes as the create page offers them, each with what its description box asks for. */
export const SONG_MODES: { value: SongMode; label: string; placeholder: string; hint?: string }[] = [
  {
    value: "describe",
    label: "Describe",
    placeholder: "Describe the song: what it is about, genre, mood, instruments, voice…",
    hint: "The model writes the lyrics. Describe the song in the language it should be sung in.",
  },
  { value: "lyrics", label: "Lyrics", placeholder: "Style: genre, mood, instruments, tempo, voice…" },
  { value: "instrumental", label: "Instrumental", placeholder: "Describe the music: genre, mood, instruments, tempo…" },
];

/** Section tags Lyria's prompt guide uses to mark a song's structure. */
export const SECTION_TAGS = ["Intro", "Verse", "Chorus", "Bridge", "Outro"];

function spokenDuration(seconds: number): string {
  if (seconds % 60 !== 0) return `${seconds} seconds`;
  const minutes = seconds / 60;
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * The one prompt a music model takes. It has no fields for length, vocals or
 * lyrics, so each is written out: the musical direction first, the lyrics last
 * beneath a "Lyrics:" header, the way Lyria's prompt guide lays them out.
 */
export function composeSongPrompt(draft: SongDraft): string {
  const requests = [
    draft.durationSeconds ? `Length: about ${spokenDuration(draft.durationSeconds)}.` : "",
    draft.mode === "instrumental" ? "Instrumental only, no vocals." : "",
  ].filter(Boolean);
  const lyrics = draft.mode === "lyrics" ? draft.lyrics.trim() : "";
  return [draft.description.trim(), requests.join(" "), lyrics && `Lyrics:\n\n${lyrics}`].filter(Boolean).join("\n\n");
}

/**
 * Put a section tag on a line of its own at the cursor, a blank line after the
 * section before it. Returns the new text and where the cursor goes.
 */
export function insertSectionTag(text: string, cursor: number, tag: string): { text: string; cursor: number } {
  const before = text.slice(0, cursor);
  const after = text.slice(cursor);
  const gap = !before.trim() ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const start = before.trim() ? before : "";
  const inserted = `${start}${gap}[${tag}]\n`;
  return { text: inserted + after.replace(/^\n/, ""), cursor: inserted.length };
}

/** "0:07", "2:41"; a dash while the length is unknown. */
export function formatTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "–:––";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export const WAVEFORM_BARS = 96;

/**
 * Loudness envelope of decoded audio: one value per bar, scaled so the loudest
 * bar is 1. RMS rather than peak, which is flat for mastered music.
 */
export function waveformPeaks(channels: Float32Array[], bars = WAVEFORM_BARS): number[] {
  const length = channels[0]?.length ?? 0;
  if (!length) return [];
  const levels = Array.from({ length: bars }, (_, bar) => {
    const from = Math.floor((bar * length) / bars);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * length) / bars));
    let sum = 0;
    for (const samples of channels) {
      for (let index = from; index < to; index++) sum += samples[index] * samples[index];
    }
    return Math.sqrt(sum / ((to - from) * channels.length));
  });
  const loudest = Math.max(...levels);
  if (!(loudest > 0)) return levels.map(() => 0);
  return levels.map((level) => Math.round((level / loudest) * 100) / 100);
}

/**
 * Length and waveform of a generated song. A file the browser can play but not
 * decode here keeps both unknown instead of losing the song.
 */
export async function songMetadata(blob: Blob): Promise<{ duration?: number; peaks: number[] }> {
  try {
    // An offline context decodes without opening an audio device.
    const context = new OfflineAudioContext(1, 1, 44_100);
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    return { duration: buffer.duration, peaks: waveformPeaks(channels) };
  } catch (error) {
    console.warn("Could not read the song's waveform:", error);
    return { peaks: [] };
  }
}

/** The gateway's MP3 typed `audio/mpeg`; null when it returned something else. */
export function asMp3(blob: Blob): Blob | null {
  const type = blob.type.split(";")[0].trim().toLowerCase();
  if (type !== "audio/mpeg" && type !== "audio/mp3") return null;
  return blob.type === "audio/mpeg" ? blob : new Blob([blob], { type: "audio/mpeg" });
}

/** Two cover colors picked from the seed, so a song looks the same wherever it is drawn. */
export function songColors(seed: string): [string, string] {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  const hue = hash % 360;
  return [`hsl(${hue}, 62%, 46%)`, `hsl(${(hue + 48) % 360}, 68%, 28%)`];
}

const POSTER_SIZE = 512;
const POSTER_BARS = 24;

/**
 * Cover art for library tiles: the waveform over the song's colors, as an SVG
 * data URL. It is redrawn from the stored waveform, never saved as a file.
 */
export function songPoster(peaks: number[], seed: string): string {
  const [from, to] = songColors(seed);
  const step = POSTER_SIZE / (POSTER_BARS + 4);
  const width = step * 0.56;
  const bars = Array.from({ length: POSTER_BARS }, (_, bar) => {
    // Tiles are small, so neighbouring bars are averaged into fewer, wider ones.
    const slice = peaks.slice(
      Math.floor((bar * peaks.length) / POSTER_BARS),
      Math.max(Math.floor(((bar + 1) * peaks.length) / POSTER_BARS), 1),
    );
    const level = slice.length ? slice.reduce((sum, peak) => sum + peak, 0) / slice.length : 0;
    const height = Math.max(width, level * POSTER_SIZE * 0.56);
    const x = step * (bar + 2) + (step - width) / 2;
    return `<rect x="${x.toFixed(1)}" y="${((POSTER_SIZE - height) / 2).toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="${(width / 2).toFixed(1)}"/>`;
  });
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${POSTER_SIZE} ${POSTER_SIZE}" width="${POSTER_SIZE}" height="${POSTER_SIZE}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="${POSTER_SIZE}" height="${POSTER_SIZE}" fill="url(#g)"/>` +
    `<g fill="#fff" fill-opacity="0.92">${bars.join("")}</g></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
