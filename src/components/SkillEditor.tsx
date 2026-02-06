import { useState, useMemo, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X } from 'lucide-react';
import { validateSkillName } from '../lib/skillParser';
import type { Skill } from '../lib/skillParser';

interface SkillEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (skill: Omit<Skill, 'id' | 'enabled'>) => void;
  skill?: Skill | null;
}

export function SkillEditor({ isOpen, onClose, onSave, skill }: SkillEditorProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [hasOpened, setHasOpened] = useState(false);

  // Track when dialog opens to reset form
  if (isOpen && !hasOpened) {
    setHasOpened(true);
    if (skill) {
      setName(skill.name);
      setDescription(skill.description);
      setContent(skill.content);
    } else {
      setName('');
      setDescription('');
      setContent('');
    }
  } else if (!isOpen && hasOpened) {
    setHasOpened(false);
  }

  // Derive name error from current name value
  // Skip showing error while user is still typing after a hyphen
  const nameError = useMemo(() => {
    if (!name || name.endsWith('-')) return null;
    const validation = validateSkillName(name);
    return validation.valid ? null : validation.error || null;
  }, [name]);

  const handleSave = () => {
    // Final validation
    const validation = validateSkillName(name);
    if (!validation.valid) {
      return;
    }

    if (!description.trim()) {
      return;
    }

    onSave({
      name,
      description: description.trim(),
      content: content.trim(),
    });
    onClose();
  };

  const isValid = name && !nameError && description.trim();

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
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 shadow-xl transition-all">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-800">
                  <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                    {skill ? 'Edit Skill' : 'New Skill'}
                  </Dialog.Title>
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Content */}
                <div className="px-6 py-4 space-y-4">
                  {/* Name field */}
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value.toLowerCase())}
                      className={`w-full px-3 py-2.5 text-sm rounded-lg bg-white dark:bg-neutral-800 border ${
                        nameError 
                          ? 'border-red-500 focus:ring-red-500' 
                          : 'border-neutral-300 dark:border-neutral-700 focus:ring-blue-500'
                      } focus:ring-2 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors`}
                      placeholder="my-skill-name"
                      disabled={!!skill} // Can't change name when editing
                    />
                    {nameError && (
                      <p className="mt-1 text-xs text-red-500">{nameError}</p>
                    )}
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      Lowercase alphanumeric characters and hyphens only. No leading/trailing or consecutive hyphens.
                    </p>
                  </div>

                  {/* Description field */}
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                      Description <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full px-3 py-2.5 text-sm rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-neutral-900 dark:text-neutral-100 resize-none transition-colors"
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
                      className="w-full px-3 py-2.5 text-sm rounded-lg bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-neutral-900 dark:text-neutral-100 font-mono resize-none transition-colors"
                      rows={12}
                      placeholder="# Skill Instructions&#10;&#10;Detailed instructions, examples, and edge cases for the AI to follow..."
                    />
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      Markdown content with step-by-step instructions for the agent.
                    </p>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium rounded-lg text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!isValid}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {skill ? 'Save Changes' : 'Create Skill'}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
