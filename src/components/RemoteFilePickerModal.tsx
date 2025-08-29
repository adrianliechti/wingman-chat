import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { RemoteFilePicker } from './RemoteFilePicker';
import type { RemoteFileSource } from '../types/repository';

interface RemoteFilePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFileSelect: (files: File[]) => Promise<void>;
  selectedSource?: RemoteFileSource | null;
}

export function RemoteFilePickerModal({ isOpen, onClose, onFileSelect, selectedSource }: RemoteFilePickerModalProps) {
  const handleFileSelect = async (files: File[]) => {
    await onFileSelect(files);
    onClose();
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
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
              <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-2xl bg-white dark:bg-neutral-800 shadow-xl transition-all">
                <RemoteFilePicker 
                  onFileSelect={handleFileSelect}
                  onClose={onClose}
                  selectedSource={selectedSource}
                />
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
