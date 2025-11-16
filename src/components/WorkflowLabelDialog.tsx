import { Fragment, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X, Tag, Trash2 } from 'lucide-react';

interface WorkflowLabelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentLabel: string;
  onSave: (label: string) => void;
  onDelete: () => void;
}

export function WorkflowLabelDialog({ isOpen, onClose, currentLabel, onSave, onDelete }: WorkflowLabelDialogProps) {
  const [label, setLabel] = useState(currentLabel);

  const handleSave = () => {
    onSave(label.trim());
    onClose();
  };

  const handleDelete = () => {
    onDelete();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog key={isOpen ? currentLabel : undefined} as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25 dark:bg-black/50" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all border border-neutral-200 dark:border-neutral-800">
                <div className="flex items-center justify-between mb-4">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-medium leading-6 text-neutral-900 dark:text-neutral-100 flex items-center gap-2"
                  >
                    <Tag className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
                    Connection Label
                  </Dialog.Title>
                  <button
                    onClick={onClose}
                    className="text-neutral-400 hover:text-neutral-500 dark:hover:text-neutral-300"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="mt-2">
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">
                    Add a label to describe the purpose of this connection
                  </p>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="e.g., search results, translated text, processed data"
                    className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white dark:bg-neutral-800/60 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500"
                    autoFocus
                  />
                </div>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="px-4 py-2 text-sm font-medium text-white bg-slate-600 hover:bg-slate-700 dark:bg-slate-500 dark:hover:bg-slate-600 rounded-lg transition-colors"
                  >
                    Save
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
