import { useState, useRef, useEffect } from "react";

interface InteractiveTextProps {
  text: string;
  placeholder?: string;
  className?: string;
  onTextSelect?: (selectedText: string, position: { x: number; y: number }, positionStart: number, positionEnd: number) => void;
  previewText?: string | null;
}

export function InteractiveText({ 
  text, 
  placeholder, 
  className = "", 
  onTextSelect,
  previewText
}: InteractiveTextProps) {
  const [hoveredWord, setHoveredWord] = useState<string | null>(null);
  const [clickedWordPosition, setClickedWordPosition] = useState<{ start: number; end: number } | null>(null);
  const [sentenceBounds, setSentenceBounds] = useState<{ start: number; end: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSelectionTimeRef = useRef<number>(0);

  // Clear highlighting when clicking outside the component
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setClickedWordPosition(null);
        setSentenceBounds(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Function to clear highlighting (can be called externally if needed)
  const clearHighlighting = () => {
    setClickedWordPosition(null);
    setSentenceBounds(null);
  };

  // Clear highlighting when text changes
  useEffect(() => {
    clearHighlighting();
  }, [text]);

  if (!text.trim()) {
    return (
      <div className={`${className} text-neutral-500 dark:text-neutral-400`}>
        {placeholder}
      </div>
    );
  }

  const handleTextSelection = () => {
    if (!onTextSelect) return;
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    
    const selectedText = selection.toString().trim();
    if (!selectedText) return;
    
    // Check if the selection is more than a single word (to avoid interfering with word clicks)
    const wordCount = selectedText.split(/\s+/).length;
    if (wordCount === 1 && selectedText.length < 20) {
      // Single short word might be from a word click, let that handler take precedence
      return;
    }
    
    // Clear word highlighting when text is selected
    setClickedWordPosition(null);
    setSentenceBounds(null);
    
    // Prevent rapid-fire selections (debounce)
    const now = Date.now();
    if (now - lastSelectionTimeRef.current < 100) return;
    lastSelectionTimeRef.current = now;
    
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Calculate text positions within the full text
    const containerElement = containerRef.current;
    if (!containerElement) return;

    // Create a range that covers all text from start to selection start
    const fullRange = document.createRange();
    fullRange.setStart(containerElement, 0);
    fullRange.setEnd(range.startContainer, range.startOffset);
    const textBeforeSelection = fullRange.toString();
    
    const positionStart = textBeforeSelection.length;
    const positionEnd = positionStart + selectedText.length;
    
    if (rect) {
      const position = {
        x: rect.left + rect.width / 2,
        y: rect.bottom + 5
      };
      
      onTextSelect(selectedText, position, positionStart, positionEnd);
    }
  };

  // Helper function to find sentence boundaries
  const findSentenceBounds = (text: string, position: number): { start: number; end: number } => {
    const sentenceEnders = /[.!?\n]/g;
    let sentenceStart = 0;
    let sentenceEnd = text.length;

    // Find the start of the sentence
    for (let i = position - 1; i >= 0; i--) {
      if (sentenceEnders.test(text[i])) {
        sentenceStart = i + 1;
        break;
      }
    }

    // Find the end of the sentence
    for (let i = position; i < text.length; i++) {
      if (sentenceEnders.test(text[i])) {
        sentenceEnd = i;
        break;
      }
    }

    return { start: sentenceStart, end: sentenceEnd };
  };

  const handleWordClick = (word: string, wordPosition: number, event: React.MouseEvent<HTMLSpanElement>) => {
    if (!onTextSelect) return;
    
    // Debounce rapid clicks
    const now = Date.now();
    if (now - lastSelectionTimeRef.current < 300) return;
    lastSelectionTimeRef.current = now;
    
    // Clear any text selection when a word is clicked
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }
    
    // Stop propagation to prevent the mouseUp event from firing on the container
    event.stopPropagation();
    event.preventDefault();
    
    // Find the actual position of the clean word within the text
    // word is the clean word (no punctuation), wordPosition is the start of the original segment
    const segment = text.substring(wordPosition, wordPosition + event.currentTarget.textContent!.length);
    const wordStartInSegment = segment.search(/[\p{L}\p{N}]/u); // Find first word character (Unicode-compatible)
    const actualWordStart = wordPosition + Math.max(0, wordStartInSegment);
    const actualWordEnd = actualWordStart + word.length;
    
    // Set the clicked word position for highlighting (only the clean word)
    setClickedWordPosition({ start: actualWordStart, end: actualWordEnd });
    
    // Find and set sentence boundaries for underlining
    const bounds = findSentenceBounds(text, actualWordStart);
    setSentenceBounds(bounds);
    
    const span = event.currentTarget;
    const rect = span.getBoundingClientRect();
    const position = {
      x: rect.left + rect.width / 2,
      y: rect.bottom + 5
    };
    
    const positionStart = actualWordStart;
    const positionEnd = actualWordEnd;
    
    onTextSelect(word, position, positionStart, positionEnd);
  };

  // Split text into words while preserving whitespace and line breaks
  const renderText = () => {
    // Use preview text if available, otherwise use the regular text
    const displayText = previewText || text;
    const lines = displayText.split('\n');
    let currentPosition = 0;
    
    return lines.map((line, lineIndex) => {
      const result = (
        <div key={lineIndex}>
          {line.split(/(\s+)/).map((segment, segmentIndex) => {
            const segmentStart = currentPosition;
            currentPosition += segment.length;
            
            // If it's whitespace, render as-is
            if (/^\s+$/.test(segment)) {
              return <span key={segmentIndex}>{segment}</span>;
            }
            
            // If it's a word (non-whitespace), make it interactive
            if (segment.trim()) {
              const cleanWord = segment.replace(/[^\p{L}\p{N}\s]/gu, ''); // Remove punctuation for synonym lookup, preserve Unicode letters
              
              // Find the actual word position within this segment
              const wordStartInSegment = segment.search(/[\p{L}\p{N}]/u); // Find first word character (Unicode-compatible)
              const actualWordStart = segmentStart + Math.max(0, wordStartInSegment);
              
              // Check if this word is clicked (highlighted) - compare actual word positions
              const isClickedWord = clickedWordPosition && 
                actualWordStart >= clickedWordPosition.start && 
                actualWordStart < clickedWordPosition.end;
              
              // Check if this word is in the current sentence (underlined)
              const isInSentence = sentenceBounds && 
                actualWordStart >= sentenceBounds.start && 
                actualWordStart < sentenceBounds.end;

              // If the segment contains only word characters, render as before
              if (segment === cleanWord) {
                return (
                  <span
                    key={segmentIndex}
                    className={`cursor-pointer transition-all duration-200 ${
                      isClickedWord
                        ? 'bg-blue-200 dark:bg-blue-800/50 text-blue-900 dark:text-blue-100 rounded px-1 font-medium'
                        : hoveredWord === cleanWord
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded px-0.5'
                        : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/50 rounded px-0.5'
                    } ${
                      isInSentence && !isClickedWord 
                        ? 'border-b border-neutral-300 dark:border-neutral-600 border-dotted' 
                        : ''
                    }`}
                    onMouseEnter={() => setHoveredWord(cleanWord)}
                    onMouseLeave={() => setHoveredWord(null)}
                    onClick={(e) => handleWordClick(cleanWord, segmentStart, e)}
                    title={`Click for alternatives to "${cleanWord}"`}
                    style={{ userSelect: 'text' }}
                  >
                    {segment}
                  </span>
                );
              }

              // If segment has punctuation, split it into parts
              const beforeWord = segment.substring(0, wordStartInSegment);
              const wordPart = segment.substring(wordStartInSegment, wordStartInSegment + cleanWord.length);
              const afterWord = segment.substring(wordStartInSegment + cleanWord.length);

              return (
                <span key={segmentIndex}>
                  {beforeWord}
                  <span
                    className={`cursor-pointer transition-all duration-200 ${
                      isClickedWord
                        ? 'bg-blue-200 dark:bg-blue-800/50 text-blue-900 dark:text-blue-100 rounded px-1 font-medium'
                        : hoveredWord === cleanWord
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded px-0.5'
                        : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/50 rounded px-0.5'
                    } ${
                      isInSentence && !isClickedWord 
                        ? 'border-b border-neutral-300 dark:border-neutral-600 border-dotted' 
                        : ''
                    }`}
                    onMouseEnter={() => setHoveredWord(cleanWord)}
                    onMouseLeave={() => setHoveredWord(null)}
                    onClick={(e) => handleWordClick(cleanWord, segmentStart, e)}
                    title={`Click for alternatives to "${cleanWord}"`}
                    style={{ userSelect: 'text' }}
                  >
                    {wordPart}
                  </span>
                  {afterWord}
                </span>
              );
            }
            
            return <span key={segmentIndex}>{segment}</span>;
        })}
        {lineIndex < lines.length - 1 && <br />}
      </div>
      );
      
      // Add newline character to position tracking if not the last line
      if (lineIndex < lines.length - 1) {
        currentPosition += 1; // for the \n character
      }
      
      return result;
    });
  };

  return (
    <div 
      ref={containerRef} 
      className={`${className} ${previewText ? 'bg-blue-50/30 dark:bg-blue-900/20 transition-colors' : ''}`}
      onMouseUp={handleTextSelection}
      style={{ userSelect: 'text' }}
    >
      {renderText()}
      {previewText && (
        <div className="absolute top-2 right-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-100/80 dark:bg-blue-900/60 px-2 py-1 rounded">
          Preview
        </div>
      )}
    </div>
  );
}
