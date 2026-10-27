import { useCallback, useId, useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { availableSkills, matchingSkills, skillTrigger, type SkillSuggestion } from "../lib/skillAutocomplete";
import { useSkills } from "@/features/skills/hooks/useSkills";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";

interface Options {
  content: string;
  setContent: (value: string) => void;
  input: RefObject<HTMLTextAreaElement | null>;
  chatId: string | null;
  enabled: boolean;
}

export function useSkillAutocomplete({ content, setContent, input, chatId, enabled }: Options) {
  const { skills: personal } = useSkills();
  const { plugins } = usePlugins();
  const listId = useId();
  const [caret, setCaret] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<{ scope: string | null; items: string[] }>({ scope: chatId, items: [] });
  const selections = chosen.scope === chatId ? chosen.items : [];
  const skills = useMemo(() => availableSkills(personal, plugins), [personal, plugins]);
  const trigger = enabled && focused ? skillTrigger(content, caret.start, caret.end) : null;
  const triggerId = trigger ? `${trigger.start}:${trigger.query}` : null;
  const open = !!trigger && triggerId !== dismissed;
  const options = trigger
    ? matchingSkills(
        skills.filter((s) => !selections.includes(s.name)),
        trigger.query,
      )
    : [];
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  const syncCaret = (element: HTMLTextAreaElement) => {
    setCaret({ start: element.selectionStart, end: element.selectionEnd });
  };
  const changed = (element: HTMLTextAreaElement) => {
    syncCaret(element);
    setActive(0);
    setDismissed(null);
  };
  const clear = useCallback(() => {
    setChosen({ scope: chatId, items: [] });
    setDismissed(null);
  }, [chatId]);
  const remove = (name: string) => setChosen({ scope: chatId, items: selections.filter((item) => item !== name) });
  const choose = (option: SkillSuggestion) => {
    if (!trigger) return;
    let after = content.slice(trigger.end);
    if (trigger.start === 0 && after.startsWith(" ")) after = after.slice(1);
    setContent(content.slice(0, trigger.start) + after);
    setCaret({ start: trigger.start, end: trigger.start });
    setActive(0);
    setDismissed(triggerId);
    setChosen({ scope: chatId, items: [...selections, option.name] });
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(trigger.start, trigger.start);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || event.nativeEvent.isComposing || event.keyCode === 229) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(triggerId);
      return true;
    }
    if (!options.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
      return true;
    }
    if (
      (event.key === "Enter" || event.key === "Tab") &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      choose(options[activeIndex]);
      return true;
    }
    return false;
  };
  return {
    listId,
    selections,
    skills,
    open,
    trigger,
    options,
    activeIndex,
    choose,
    remove,
    clear,
    setActive,
    onKeyDown,
    syncCaret,
    changed,
    setFocused,
  };
}
