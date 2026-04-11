import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface InteractiveTextProps {
  text: string;
  placeholder?: string;
  className?: string;
  onTextSelect?: (
    selectedText: string,
    position: { x: number; y: number },
    positionStart: number,
    positionEnd: number,
  ) => void;
  previewText?: string | null;
}

interface WordInfo {
  original: string;
  clean: string;
  start: number;
  end: number;
}

export function InteractiveText({
  text,
  placeholder,
  className = "",
  onTextSelect,
  previewText,
}: InteractiveTextProps) {
  const [hoveredWord, setHoveredWord] = useState<string | null>(null);
  const [selectedWord, setSelectedWord] = useState<WordInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSelectionTimeRef = useRef<number>(0);

  const displayText = previewText || text;

  // Parse text into words with positions
  const words = useMemo(() => {
    const wordList: WordInfo[] = [];
    const regex = /[\p{L}\p{N}]+/gu;
    let match: RegExpExecArray | null = regex.exec(displayText);

    while (match !== null) {
      wordList.push({
        original: match[0],
        clean: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });

      match = regex.exec(displayText);
    }

    return wordList;
  }, [displayText]);

  // Clear selection when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setSelectedWord(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Clear highlighting when text changes
  useEffect(() => {
    if (displayText || displayText === "") {
      setSelectedWord(null);
    }
  }, [displayText]);

  // Handle text selection
  const handleTextSelection = useCallback(() => {
    if (!onTextSelect) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // Debounce rapid selections
    const now = Date.now();
    if (now - lastSelectionTimeRef.current < 100) return;
    lastSelectionTimeRef.current = now;

    // Skip single short words (handled by word click)
    if (selectedText.split(/\s+/).length === 1 && selectedText.length < 20) return;

    // Clear word selection
    setSelectedWord(null);

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (!containerRef.current) return;

    // Calculate position in text
    const fullRange = document.createRange();
    fullRange.setStart(containerRef.current, 0);
    fullRange.setEnd(range.startContainer, range.startOffset);
    const positionStart = fullRange.toString().length;
    const positionEnd = positionStart + selectedText.length;

    onTextSelect(
      selectedText,
      {
        x: rect.left + rect.width / 2,
        y: rect.bottom + 5,
      },
      positionStart,
      positionEnd,
    );
  }, [onTextSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      handleTextSelection();
    };

    container.addEventListener("mouseup", handleMouseUp);
    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleTextSelection]);

  // Handle word click
  const handleWordClick = useCallback(
    (word: WordInfo, event: React.MouseEvent) => {
      if (!onTextSelect) return;

      event.stopPropagation();
      event.preventDefault();

      // Clear text selection
      window.getSelection()?.removeAllRanges();

      // Set selected word
      setSelectedWord(word);

      const rect = event.currentTarget.getBoundingClientRect();
      onTextSelect(
        word.clean,
        {
          x: rect.left + rect.width / 2,
          y: rect.bottom + 5,
        },
        word.start,
        word.end,
      );
    },
    [onTextSelect],
  );

  // Render empty state
  if (!displayText.trim()) {
    return <div className={`${className} text-neutral-500 dark:text-neutral-400`}>{placeholder}</div>;
  }

  // Render text with interactive words
  const renderText = () => {
    let lastEnd = 0;
    const elements: React.ReactNode[] = [];

    const pushTextSegment = (segment: string, segmentStart: number) => {
      let offset = 0;

      for (const line of segment.split("\n")) {
        const lineStart = segmentStart + offset;
        elements.push(<span key={`text-${lineStart}`}>{line}</span>);
        offset += line.length;

        if (offset < segment.length) {
          elements.push(<br key={`break-${segmentStart + offset}`} />);
          offset += 1;
        }
      }
    };

    words.forEach((word) => {
      // Add text before word
      if (word.start > lastEnd) {
        const textBefore = displayText.substring(lastEnd, word.start);
        pushTextSegment(textBefore, lastEnd);
      }

      const isSelected = selectedWord?.start === word.start;
      const isHovered = hoveredWord === word.clean;

      // Add interactive word
      elements.push(
        <button
          key={`word-${word.start}-${word.end}`}
          type="button"
          className={`
            inline rounded border-0 bg-transparent p-0 text-inherit transition-all duration-200
            ${
              isSelected
                ? "bg-blue-200 dark:bg-blue-800/50 text-blue-900 dark:text-blue-100 px-1 font-medium"
                : isHovered
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 px-0.5"
                  : "hover:bg-neutral-100 dark:hover:bg-neutral-800/50 px-0.5"
            }
          `}
          onMouseEnter={() => setHoveredWord(word.clean)}
          onMouseLeave={() => setHoveredWord(null)}
          onClick={(e) => handleWordClick(word, e)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              handleWordClick(word, e as unknown as React.MouseEvent);
            }
          }}
          title={`Click for alternatives to "${word.clean}"`}
        >
          {word.original}
        </button>,
      );

      lastEnd = word.end;
    });

    // Add remaining text
    if (lastEnd < displayText.length) {
      const textAfter = displayText.substring(lastEnd);
      pushTextSegment(textAfter, lastEnd);
    }

    return elements;
  };

  return (
    <div
      ref={containerRef}
      className={`${className}`}
      style={{ userSelect: "text" }}
    >
      {renderText()}
    </div>
  );
}
