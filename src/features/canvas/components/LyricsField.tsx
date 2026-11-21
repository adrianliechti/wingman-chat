import { useLayoutEffect, useRef } from "react";
import { insertSectionTag, SECTION_TAGS } from "../lib/song";

interface LyricsFieldProps {
  lyrics: string;
  onLyricsChange: (lyrics: string) => void;
  onSubmit: () => void;
}

const LYRICS_PLACEHOLDER = "[Verse]\nWalking through the morning light…\n\n[Chorus]\nWe keep moving on…";

/**
 * The user's own lyrics, typed as they should be sung with one section tag per
 * part. It is the lower part of the create page's text box and fills the height
 * left there, so the page keeps its size.
 */
export function LyricsField({ lyrics, onLyricsChange, onSubmit }: LyricsFieldProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const cursorAfterInsert = useRef<number | null>(null);

  // Put the cursor on the line below an inserted tag as soon as the new text
  // is in the field, so typing straight after the click lands there.
  useLayoutEffect(() => {
    const cursor = cursorAfterInsert.current;
    if (cursor === null) return;
    cursorAfterInsert.current = null;
    textarea.current?.focus();
    textarea.current?.setSelectionRange(cursor, cursor);
  }, [lyrics]);

  const insertTag = (tag: string) => {
    const next = insertSectionTag(lyrics, textarea.current?.selectionStart ?? lyrics.length, tag);
    cursorAfterInsert.current = next.cursor;
    onLyricsChange(next.text);
  };

  return (
    <div className="flex min-h-40 flex-1 flex-col">
      <textarea
        ref={textarea}
        aria-label="Lyrics"
        value={lyrics}
        placeholder={LYRICS_PLACEHOLDER}
        onChange={(event) => onLyricsChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          // Enter starts the next line of the song; the modifier sends it.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
        className="block min-h-0 w-full flex-1 resize-none bg-transparent px-4 pt-3 pb-2 text-sm leading-relaxed text-neutral-800 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
      />
      <div className="flex shrink-0 flex-wrap items-center gap-1 px-3 pb-3">
        <span className="mr-1 text-[11px] text-neutral-500 dark:text-neutral-400">Add section</span>
        {SECTION_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            // Keep the cursor in the lyrics while the tag is clicked.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => insertTag(tag)}
            className="rounded-md px-1.5 py-0.5 font-mono text-[11px] text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-200"
          >
            [{tag}]
          </button>
        ))}
      </div>
    </div>
  );
}
