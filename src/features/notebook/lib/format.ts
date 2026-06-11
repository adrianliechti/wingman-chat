/** Format a duration in seconds as zero-padded `mm:ss` (e.g. 75 → "01:15"). */
export function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
