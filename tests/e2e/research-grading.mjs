export const normalize = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// A citation may point to a section within a retrieved document. Preserve the
// path and query so a different page or similarly prefixed hostname cannot pass.
function documentURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

// Deterministic entity-set F1 and citation coverage, not semantic entailment.
// Gold answers are visible to the grader only, never to the model under test.
export function gradeResearchAnswer(text, expected, observed) {
  let items;
  try {
    items = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()).items;
    if (
      !Array.isArray(items) ||
      items.some(
        (item) =>
          !item ||
          typeof item.answer !== "string" ||
          !Array.isArray(item.sources) ||
          item.sources.some((url) => typeof url !== "string"),
      )
    )
      throw new Error("Invalid items");
  } catch {
    return { answerF1: 0, citationRecall: 0, validAnswer: false };
  }
  const canonical = (answer) => {
    const value = normalize(answer);
    const gold = expected.find((item) =>
      [item.answer, ...(item.aliases ?? [])].some((alias) => normalize(alias) === value),
    );
    return gold ? normalize(gold.answer) : value;
  };
  const predictions = new Set(items.map(({ answer }) => canonical(answer)));
  const correct = expected.filter(({ answer }) => predictions.has(normalize(answer)));
  const f1 = expected.length + predictions.size ? (2 * correct.length) / (expected.length + predictions.size) : 1;
  const observedURLs = new Set((observed.match(/https?:\/\/[^\s<>"'[\]()]+/g) ?? []).map(documentURL).filter(Boolean));
  const cited = correct.filter((gold) =>
    items.some((item) => {
      const citations = new Set(item.sources.map(documentURL).filter(Boolean));
      return (
        canonical(item.answer) === normalize(gold.answer) &&
        [...citations].some((url) => observedURLs.has(url)) &&
        gold.sources.every((url) => citations.has(documentURL(url)) && observedURLs.has(documentURL(url)))
      );
    }),
  );
  return {
    answerF1: f1,
    citationRecall: expected.length ? cited.length / expected.length : Number(!items.length),
    validAnswer: true,
  };
}
