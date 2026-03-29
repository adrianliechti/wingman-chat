import { useState } from "react";
import { Check, X, ChevronRight, RotateCcw } from "lucide-react";
import type { QuizQuestion } from "../types/notebook";

interface QuizViewerProps {
  questions: QuizQuestion[];
}

export function QuizViewer({ questions }: QuizViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const question = questions[currentIndex];

  const handleSelect = (optionIndex: number) => {
    if (revealed) return;
    setSelected(optionIndex);
    setRevealed(true);
    if (optionIndex === question.correctIndex) {
      setScore((s) => s + 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
      setSelected(null);
      setRevealed(false);
    } else {
      setFinished(true);
    }
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setSelected(null);
    setRevealed(false);
    setScore(0);
    setFinished(false);
  };

  if (finished) {
    const percentage = Math.round((score / questions.length) * 100);
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <span className="text-2xl font-bold text-neutral-700 dark:text-neutral-300">{percentage}%</span>
          </div>
          <p className="text-lg font-semibold text-neutral-800 dark:text-neutral-200 mb-1">
            {score} / {questions.length} correct
          </p>
          <p className="text-sm text-neutral-500 mb-6">
            {percentage >= 80 ? "Excellent work!" : percentage >= 60 ? "Good effort!" : "Keep studying!"}
          </p>
          <button
            type="button"
            onClick={handleRestart}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 rounded-lg hover:opacity-90 transition-opacity"
          >
            <RotateCcw size={14} />
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Progress */}
      <div className="px-6 pt-6 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-neutral-400">
            Question {currentIndex + 1} of {questions.length}
          </span>
          <span className="text-xs text-neutral-400">Score: {score}</span>
        </div>
        <div className="h-1 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-neutral-800 dark:bg-neutral-200 rounded-full transition-all duration-300"
            style={{ width: `${((currentIndex + (revealed ? 1 : 0)) / questions.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
        <h3 className="text-base font-medium text-neutral-800 dark:text-neutral-200 mb-5 leading-relaxed">
          {question.question}
        </h3>

        <div className="space-y-2.5">
          {question.options.map((option, i) => {
            const isCorrect = i === question.correctIndex;
            const isSelected = i === selected;

            let styles =
              "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600";
            if (revealed) {
              if (isCorrect) {
                styles = "border-green-500 bg-green-50 dark:bg-green-950/30";
              } else if (isSelected && !isCorrect) {
                styles = "border-red-500 bg-red-50 dark:bg-red-950/30";
              } else {
                styles = "border-neutral-200 dark:border-neutral-700 opacity-50";
              }
            } else if (isSelected) {
              styles = "border-neutral-800 dark:border-neutral-200";
            }

            return (
              <button
                key={i}
                type="button"
                onClick={() => handleSelect(i)}
                disabled={revealed}
                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${styles}`}
              >
                <div className="flex items-center gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full border border-neutral-300 dark:border-neutral-600 flex items-center justify-center text-xs font-medium text-neutral-500">
                    {revealed && isCorrect ? (
                      <Check size={14} className="text-green-600" />
                    ) : revealed && isSelected && !isCorrect ? (
                      <X size={14} className="text-red-600" />
                    ) : (
                      String.fromCharCode(65 + i)
                    )}
                  </span>
                  <span className="text-sm text-neutral-700 dark:text-neutral-300">{option}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Explanation */}
        {revealed && (
          <div className="mt-4 px-4 py-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200 dark:border-neutral-700">
            <p className="text-xs font-medium text-neutral-500 mb-1">Explanation</p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{question.explanation}</p>
          </div>
        )}
      </div>

      {/* Next button */}
      {revealed && (
        <div className="px-6 py-4 border-t border-neutral-200 dark:border-neutral-800 shrink-0">
          <button
            type="button"
            onClick={handleNext}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 rounded-lg hover:opacity-90 transition-opacity"
          >
            {currentIndex < questions.length - 1 ? (
              <>
                Next question
                <ChevronRight size={14} />
              </>
            ) : (
              "See results"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
