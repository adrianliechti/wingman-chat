import { flip, offset, shift, useFloating } from "@floating-ui/react-dom";
import { Bot, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { cn } from "@/shared/lib/cn";

export function AgentHintButton() {
  const { currentAgent, showAgentDrawer, setShowAgentDrawer } = useAgents();
  const [hintOpen, setHintOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const { refs, floatingStyles } = useFloating({
    placement: "bottom-end",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });

  // Dismiss hint on outside click
  useEffect(() => {
    if (!hintOpen) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      const floating = refs.floating.current;
      if (floating?.contains(target)) return;
      setHintOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [hintOpen, refs.floating]);

  // Close hint when drawer opens
  useEffect(() => {
    if (showAgentDrawer) setHintOpen(false);
  }, [showAgentDrawer]);

  function handleClick() {
    if (showAgentDrawer) {
      setShowAgentDrawer(false);
      return;
    }
    if (currentAgent) {
      setShowAgentDrawer(true);
      return;
    }
    setHintOpen((v) => !v);
  }

  return (
    <>
      <button
        ref={(el) => {
          (buttonRef as React.MutableRefObject<HTMLButtonElement | null>).current = el;
          refs.setReference(el);
        }}
        type="button"
        aria-label={showAgentDrawer ? "Close agent" : currentAgent ? "Open agent" : "Agent info"}
        aria-expanded={showAgentDrawer || hintOpen}
        title={showAgentDrawer ? "Close agent" : currentAgent ? currentAgent.name : undefined}
        className={cn(
          "p-2 rounded-full transition-all duration-150 ease-out",
          showAgentDrawer
            ? "text-neutral-900 dark:text-neutral-100 bg-neutral-200 dark:bg-neutral-700/60"
            : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200",
        )}
        onClick={handleClick}
      >
        <Bot size={20} />
      </button>

      {hintOpen &&
        createPortal(
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-9999 w-64 rounded-xl border-2 bg-white/80 dark:bg-neutral-950/90 backdrop-blur-3xl border-white/40 dark:border-neutral-700/60 shadow-lg shadow-black/20 dark:shadow-black/50 dark:ring-1 dark:ring-white/10 px-4 py-3"
          >
            <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-1">Activate an agent</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
              Use the{" "}
              <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-neutral-200 dark:bg-neutral-700 align-text-bottom">
                <Plus size={10} className="text-neutral-700 dark:text-neutral-300" />
              </span>{" "}
              icon in the chat input to select or manage agents.
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
