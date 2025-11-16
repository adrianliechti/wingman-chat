import { useState, useRef, useEffect, useCallback, useMemo } from "react";

interface InteractiveTextProps {
  text: string;
  placeholder?: string;
  className?: string;
  onTextSelect?: (selectedText: string, position: { x: number; y: number }, positionStart: number, positionEnd: number) => void;
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
  previewText
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
    let match;
    
    while ((match = regex.exec(displayText)) !== null) {
      wordList.push({
        original: match[0],
        clean: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
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

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clear highlighting when text changes
  useEffect(() => {
    return () => {
      setSelectedWord(null);
    };
  }, [text]);

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
    
    onTextSelect(selectedText, {
      x: rect.left + rect.width / 2,
      y: rect.bottom + 5
    }, positionStart, positionEnd);
  }, [onTextSelect]);

  // Handle word click
  const handleWordClick = useCallback((word: WordInfo, event: React.MouseEvent) => {
    if (!onTextSelect) return;
    
    event.stopPropagation();
    event.preventDefault();
    
    // Clear text selection
    window.getSelection()?.removeAllRanges();
    
    // Set selected word
    setSelectedWord(word);
    
    const rect = event.currentTarget.getBoundingClientRect();
    onTextSelect(word.clean, {
      x: rect.left + rect.width / 2,
      y: rect.bottom + 5
    }, word.start, word.end);
  }, [onTextSelect]);

  // Render empty state
  if (!displayText.trim()) {
    return (
      <div className={`${className} text-neutral-500 dark:text-neutral-400`}>
        {placeholder}
      </div>
    );
  }

  // Render text with interactive words
  const renderText = () => {
    let lastEnd = 0;
    const elements: React.ReactNode[] = [];
    
    words.forEach((word, index) => {
      // Add text before word
      if (word.start > lastEnd) {
        const textBefore = displayText.substring(lastEnd, word.start);
        elements.push(
          <span key={`text-${index}`}>
            {textBefore.split('\n').map((line, i, arr) => (
              <span key={i}>
                {line}
                {i < arr.length - 1 && <br />}
              </span>
            ))}
          </span>
        );
      }
      
      const isSelected = selectedWord?.start === word.start;
      const isHovered = hoveredWord === word.clean;
      
      // Add interactive word
      elements.push(
        <span
          key={`word-${index}`}
          className={`
            cursor-pointer transition-all duration-200 rounded
            ${isSelected ? 'bg-blue-200 dark:bg-blue-800/50 text-blue-900 dark:text-blue-100 px-1 font-medium' :
              isHovered ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 px-0.5' :
              'hover:bg-neutral-100 dark:hover:bg-neutral-800/50 px-0.5'}
          `}
          onMouseEnter={() => setHoveredWord(word.clean)}
          onMouseLeave={() => setHoveredWord(null)}
          onClick={(e) => handleWordClick(word, e)}
          title={`Click for alternatives to "${word.clean}"`}
        >
          {word.original}
        </span>
      );
      
      lastEnd = word.end;
    });
    
    // Add remaining text
    if (lastEnd < displayText.length) {
      const textAfter = displayText.substring(lastEnd);
      elements.push(
        <span key="text-end">
          {textAfter.split('\n').map((line, i, arr) => (
            <span key={i}>
              {line}
              {i < arr.length - 1 && <br />}
            </span>
          ))}
        </span>
      );
    }
    
    return elements;
  };

  return (
    <div 
      ref={containerRef} 
      className={`${className}`}
      onMouseUp={handleTextSelection}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setSelectedWord(null);
        }
      }}
      style={{ userSelect: 'text' }}
    >
      {renderText()}
    </div>
  );
}