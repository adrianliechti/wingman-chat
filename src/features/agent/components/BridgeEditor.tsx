import { useState, useMemo, Fragment, useId } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, Plus, Trash2 } from "lucide-react";
import type { BridgeServer } from "@/features/settings/context/BridgeContext";

interface BridgeEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (bridge: Omit<BridgeServer, "id">) => void;
  onDelete?: () => void;
  bridge?: BridgeServer | null;
}

interface HeaderEntry {
  id: string;
  key: string;
  value: string;
}

export function BridgeEditor({ isOpen, onClose, onSave, onDelete, bridge }: BridgeEditorProps) {
  const nameInputId = useId();
  const urlInputId = useId();
  const descriptionInputId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderEntry[]>([]);
  const [hasOpened, setHasOpened] = useState(false);

  // Track when dialog opens to reset form
  if (isOpen && !hasOpened) {
    setHasOpened(true);
    if (bridge) {
      setName(bridge.name);
      setDescription(bridge.description);
      setUrl(bridge.url);
      // Convert headers object to array
      const headerEntries = bridge.headers
        ? Object.entries(bridge.headers).map(([key, value]) => ({
            id: crypto.randomUUID(),
            key,
            value,
          }))
        : [];
      setHeaders(headerEntries);
    } else {
      setName("");
      setDescription("");
      setUrl("");
      setHeaders([]);
    }
  } else if (!isOpen && hasOpened) {
    setHasOpened(false);
  }

  // Validate URL
  const urlError = useMemo(() => {
    if (!url) return null;
    try {
      new URL(url);
      return null;
    } catch {
      return "Please enter a valid URL";
    }
  }, [url]);

  const handleAddHeader = () => {
    setHeaders((prev) => [...prev, { id: crypto.randomUUID(), key: "", value: "" }]);
  };

  const handleUpdateHeader = (id: string, field: "key" | "value", value: string) => {
    setHeaders((prev) => prev.map((header) => (header.id === id ? { ...header, [field]: value } : header)));
  };

  const handleRemoveHeader = (id: string) => {
    setHeaders((prev) => prev.filter((header) => header.id !== id));
  };

  const handleSave = () => {
    if (!name.trim() || !url.trim() || urlError) {
      return;
    }

    // Convert headers array back to object, filtering empty entries
    const headersObject = headers
      .filter((h) => h.key.trim() && h.value.trim())
      .reduce(
        (acc, h) => {
          acc[h.key.trim()] = h.value.trim();
          return acc;
        },
        {} as Record<string, string>,
      );

    onSave({
      name: name.trim(),
      description: description.trim(),
      url: url.trim(),
      headers: Object.keys(headersObject).length > 0 ? headersObject : undefined,
      enabled: bridge?.enabled ?? true,
    });
    onClose();
  };

  const isValid = name.trim() && url.trim() && !urlError;

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
              <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-xl transition-all">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-200/60 dark:border-neutral-800/60">
                  <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                    {bridge ? "Edit MCP Server" : "Add MCP Server"}
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
                    <label htmlFor={nameInputId} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      id={nameInputId}
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors"
                      placeholder="My MCP Server"
                    />
                  </div>

                  {/* URL field */}
                  <div>
                    <label htmlFor={urlInputId} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                      URL <span className="text-red-500">*</span>
                    </label>
                    <input
                      id={urlInputId}
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className={`w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border ${
                        urlError
                          ? "border-red-400/70 focus:ring-red-500/60"
                          : "border-neutral-300/60 dark:border-neutral-700/60 focus:ring-neutral-500/60"
                      } focus:ring-2 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors`}
                      placeholder="https://example.com/mcp"
                    />
                    {urlError && <p className="mt-1 text-xs text-red-500">{urlError}</p>}
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">The MCP server endpoint URL</p>
                  </div>

                  {/* Description field */}
                  <div>
                    <label
                      htmlFor={descriptionInputId}
                      className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
                    >
                      Description
                    </label>
                    <textarea
                      id={descriptionInputId}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 resize-none transition-colors"
                      rows={2}
                      placeholder="Describe what this bridge provides..."
                    />
                  </div>

                  {/* Headers section */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">Headers</p>
                      <button
                        type="button"
                        onClick={handleAddHeader}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors"
                      >
                        <Plus size={12} />
                        Add Header
                      </button>
                    </div>
                    {headers.length > 0 && (
                      <div className="space-y-2">
                        {headers.map((header) => (
                          <div key={header.id} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={header.key}
                              onChange={(e) => handleUpdateHeader(header.id, "key", e.target.value)}
                              className="flex-1 px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors"
                              placeholder="Header name"
                            />
                            <input
                              type="text"
                              value={header.value}
                              onChange={(e) => handleUpdateHeader(header.id, "value", e.target.value)}
                              className="flex-1 px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors"
                              placeholder="Header value"
                            />
                            <button
                              type="button"
                              onClick={() => handleRemoveHeader(header.id)}
                              className="p-1.5 rounded-md text-neutral-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                      Optional HTTP headers to include with requests (e.g., Authorization)
                    </p>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-200/60 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/30">
                  {bridge && onDelete ? (
                    <button
                      type="button"
                      onClick={() => {
                        onDelete();
                        onClose();
                      }}
                      className="px-3 py-1.5 text-xs font-medium rounded-md text-red-600 dark:text-red-400 hover:bg-red-100/60 dark:hover:bg-red-950/40 transition-colors"
                    >
                      Delete
                    </button>
                  ) : (
                    <span />
                  )}
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
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
