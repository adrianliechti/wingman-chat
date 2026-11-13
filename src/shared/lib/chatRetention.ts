/** Use calendar days consistently for local expiration and incoming backups. */
export function chatRetentionCutoff(days: number | undefined): Date | null {
  if (!days || days <= 0) return null;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}
