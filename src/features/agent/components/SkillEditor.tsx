import { useState, useMemo, Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, Sparkles, Loader2 } from "lucide-react";
import { validateSkillName } from "@/features/skills/lib/skillParser";
import type { Skill } from "@/features/skills/lib/skillParser";
import { getConfig } from "@/shared/config";

interface SkillEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (skill: Omit<Skill, "id">) => void;
  skill?: Skill | null;
}

export function SkillEditor({ isOpen, onClose, onSave, skill }: SkillEditorProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [hasOpened, setHasOpened] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);

  // Track when dialog opens to reset form
  if (isOpen && !hasOpened) {
    setHasOpened(true);
    if (skill) {
      setName(skill.name);
      setDescription(skill.description);
      setContent(skill.content);
    } else {
      setName("");
      setDescription("");
      setContent("");
    }
  } else if (!isOpen && hasOpened) {
    setHasOpened(false);
  }

  // Derive name error from current name value
  // Skip showing error while user is still typing after a hyphen
  const nameError = useMemo(() => {
    if (!name || name.endsWith("-")) return null;
    const validation = validateSkillName(name);
    return validation.valid ? null : validation.error || null;
  }, [name]);

  const handleSave = () => {
    // Final validation
    const validation = validateSkillName(name);
    if (!validation.valid) {
      return;
    }

    if (!description.trim() || !content.trim()) {
      return;
    }

    onSave({
      name,
      description: description.trim(),
      content: content.trim(),
    });
    onClose();
  };

  const handleOptimize = async () => {
    if (isOptimizing) return;
    setIsOptimizing(true);
    try {
      const config = getConfig();
      const result = await config.client.optimizeSkill(config.chat?.optimizer || "", name, description, content);
      setName(result.name);
      setDescription(result.description);
      setContent(result.content);
    } catch (error) {
      console.error("Failed to optimize skill:", error);
    } finally {
      setIsOptimizing(false);
    }
  };

  const canOptimize = (description.trim().length > 0 || content.trim().length > 0) && !isOptimizing;
  const isValid = name && !nameError && description.trim() && content.trim();

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-80" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40 dark:bg-black/60" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-xl transition-all">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-200/60 dark:border-neutral-800/60">
                  <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                    {skill ? "Edit Skill" : "New Skill"}
                  </Dialog.Title>
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Content */}
                <div className="px-5 py-3.5 space-y-3.5">
                  {/* Name field */}
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                      Name{" "}
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value.toLowerCase())}
                      className={`w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border ${
                        nameError
                          ? "border-red-400/70 focus:ring-red-500/60"
                          : "border-neutral-300/60 dark:border-neutral-700/60 focus:ring-blue-500/60"
                      } focus:ring-2 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors`}
                      placeholder="my-skill-name"
                    />
                    {nameError && <p className="mt-1 text-xs text-red-500">{nameError}</p>}
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      Lowercase alphanumeric characters and hyphens only. No leading/trailing or consecutive hyphens.
                    </p>
                  </div>

                  {/* Description field */}
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                      Description{" "}
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-blue-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 resize-none transition-colors"
                      rows={2}
                      placeholder="Describe what this skill does and when to use it..."
                    />
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      Brief description of the skill's purpose (max 1024 characters).
                    </p>
                  </div>

                  {/* Content field */}
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                      Instructions
                    </label>
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-blue-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 font-mono resize-none transition-colors"
                      rows={10}
                      placeholder="# Skill Instructions&#10;&#10;Detailed instructions, examples, and edge cases for the AI to follow..."
                    />
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      Markdown content with step-by-step instructions for the agent.
                    </p>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-200/60 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/30">
                  <button
                    type="button"
                    onClick={handleOptimize}
                    disabled={!canOptimize}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-neutral-300/60 dark:border-neutral-700/60 text-neutral-500 dark:text-neutral-400 hover:text-amber-600 dark:hover:text-amber-400 hover:border-amber-300/60 dark:hover:border-amber-700/60 hover:bg-amber-50/40 dark:hover:bg-amber-950/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {isOptimizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {isOptimizing ? "Optimizing…" : "Optimize"}
                  </button>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-3 py-1.5 text-xs font-medium rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={!isValid}
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600/90 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
