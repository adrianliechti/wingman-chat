// Small live-web smoke set, deliberately separate from fixed-fixture scores.
// Historical gold answers; source URLs may vary with search ranking.
export const webCases = [
  {
    id: "paper-search",
    question:
      "Find the AgentWebBench paper (arXiv 2604.10938v1). How many websites and documents are in its corpus? Return separate items 'Websites: N' and 'Documents: N million'.",
    expected: [
      { answer: "Websites: 100", sources: [] },
      // Section 3.4: 18,427,770. Accept its correctly rounded million forms.
      {
        answer: "Documents: 18.4 million",
        aliases: [
          "Documents: 18.43 million",
          "Documents: 18.428 million",
          "Documents: 18.4278 million",
          "Documents: 18.42777 million",
          "Documents: 18.427770 million",
        ],
        sources: [],
      },
    ],
  },
  {
    id: "award-search",
    question:
      "Find the films awarded the Cannes Palme d'Or in 2021, 2022 and 2023. Return three items, each containing only the English film title (or original title if it has no English title).",
    expected: [
      { answer: "Titane", sources: [] },
      { answer: "Triangle of Sadness", sources: [] },
      { answer: "Anatomy of a Fall", sources: [] },
    ],
  },
  {
    id: "paper-reading",
    question:
      "Read https://arxiv.org/html/2604.10938v1 and report the number of samples in its question answering and deep research evaluation tasks. Return separate items 'QA: N' and 'Deep research: N'.",
    expected: [
      { answer: "QA: 53", sources: [] },
      { answer: "Deep research: 331", sources: [] },
    ],
  },
];
