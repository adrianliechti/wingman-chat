const THINKING_WORDS = [
  "Thinking",
  "Pondering",
  "Mulling",
  "Noodling",
  "Reasoning",
  "Cogitating",
  "Ruminating",
  "Percolating",
  "Contemplating",
  "Considering",
  "Deliberating",
  "Deciphering",
  "Brewing",
  "Churning",
  "Conjuring",
  "Concocting",
  "Distilling",
  "Envisioning",
  "Hatching",
  "Ideating",
  "Imagining",
  "Incubating",
  "Inferring",
  "Marinating",
  "Musing",
  "Orchestrating",
  "Puzzling",
  "Scheming",
  "Simmering",
  "Sketching",
  "Stewing",
  "Synthesizing",
  "Tinkering",
  "Untangling",
  "Wrangling",
] as const;

/** Pick a varied but stable label for the lifetime of an agent run. */
export function getThinkingWord(runKey: string): string {
  let hash = 2166136261;
  for (let i = 0; i < runKey.length; i++) {
    hash ^= runKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return THINKING_WORDS[(hash >>> 0) % THINKING_WORDS.length];
}
