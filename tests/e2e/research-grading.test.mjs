import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeResearchAnswer } from "./research-grading.mjs";
import { webCases } from "./fixtures/research-web-cases.mjs";

const url = "https://example.com/evidence";
const expected = [
  { answer: "Alpha", sources: [url] },
  { answer: "Beta", sources: [url] },
];
const answer = (items) => JSON.stringify({ items: items.map((name) => ({ answer: name, sources: [url] })) });

void test("explicit aliases accept verified precision without accepting wrong values or duplicate credit", () => {
  const gold = [{ ...webCases[0].expected[1], sources: [url] }];
  assert.equal(gradeResearchAnswer(answer(["Documents: 18.42777 million"]), gold, url).answerF1, 1);
  assert.equal(gradeResearchAnswer(answer(["Documents: 18.42777 million"]), gold, url).citationRecall, 1);
  assert.equal(
    gradeResearchAnswer(answer(["Documents: 18.4 million", "Documents: 18.42777 million"]), gold, url).answerF1,
    1,
  );
  assert.equal(gradeResearchAnswer(answer(["Documents: 18.5 million"]), gold, url).answerF1, 0);
  assert.equal(gradeResearchAnswer(answer(["Documents: 18.42 million"]), gold, url).answerF1, 0);
  for (const value of ["18.43", "18.428", "18.4278", "18.427770"])
    assert.equal(gradeResearchAnswer(answer([`Documents: ${value} million`]), gold, url).answerF1, 1);
});

void test("set F1 penalizes missing and extra answers without rewarding duplicates", () => {
  assert.equal(gradeResearchAnswer(answer(["Alpha", "Alpha"]), expected, url).answerF1, 2 / 3);
  assert.equal(gradeResearchAnswer(answer(["Alpha", "Beta", "Gamma"]), expected, url).answerF1, 4 / 5);
  assert.equal(gradeResearchAnswer(answer(["alpha", "BETA"]), expected, url).answerF1, 1);
});

void test("citations must cover the gold sources and appear in retrieved output", () => {
  assert.equal(gradeResearchAnswer(answer(["Alpha", "Beta"]), expected, "").citationRecall, 0);
  assert.equal(gradeResearchAnswer(answer(["Alpha", "Beta"]), expected, url).citationRecall, 1);
  const chain = [{ answer: "Alpha", sources: [url, "https://example.com/team"] }];
  assert.equal(gradeResearchAnswer(answer(["Alpha"]), chain, chain[0].sources.join("\n")).citationRecall, 0);
});

void test("live cases without fixed URLs still require a retrieved citation", () => {
  const expected = [{ answer: "Alpha", sources: [] }];
  assert.equal(gradeResearchAnswer('{"items":[{"answer":"Alpha","sources":[]}]}', expected, url).citationRecall, 0);
  assert.equal(gradeResearchAnswer(answer(["Alpha"]), expected, url).citationRecall, 1);
});

void test("section citations refer to the retrieved document, not a different path, query, or hostname", () => {
  const gold = [{ answer: "Alpha", sources: [url] }];
  const response = (source) => JSON.stringify({ items: [{ answer: "Alpha", sources: [source] }] });
  assert.equal(gradeResearchAnswer(response(`${url}#section`), gold, `[source](${url})`).citationRecall, 1);
  assert.equal(gradeResearchAnswer(response(url), gold, `${url}#other-section`).citationRecall, 1);
  for (const other of [`${url}/different`, `${url}?edition=2`, "https://example.com.evil/evidence"])
    assert.equal(gradeResearchAnswer(response(other), gold, url).citationRecall, 0);
  const openGold = [{ answer: "Alpha", sources: [] }];
  assert.equal(gradeResearchAnswer(response(url), openGold, `${url}-different`).citationRecall, 0);
  assert.equal(
    gradeResearchAnswer(response("https://example.com"), openGold, "https://example.com.evil").citationRecall,
    0,
  );
});

void test("abstention is correct only when the gold set is empty; malformed responses fail", () => {
  assert.equal(gradeResearchAnswer(answer([]), [], "").answerF1, 1);
  assert.equal(gradeResearchAnswer(answer([]), expected, "").answerF1, 0);
  assert.equal(gradeResearchAnswer("invalid JSON", [], "").answerF1, 0);
  assert.equal(gradeResearchAnswer('{"items":[null]}', [], "").validAnswer, false);
  assert.equal(gradeResearchAnswer('{"items":[{"answer":"Alpha","sources":[1]}]}', [], "").validAnswer, false);
  assert.equal(gradeResearchAnswer('```json\n{"items":[]}\n```', [], "").validAnswer, true);
});
