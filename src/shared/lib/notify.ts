import { toast } from "sonner";

function describe(detail?: unknown): string | undefined {
  if (detail instanceof Error) return detail.message || undefined;
  if (typeof detail === "string" && detail.trim()) return detail;
  return undefined;
}

// Toasts as a short, descriptive title + optional detailed message. For errors,
// `detail` may be a caught Error (its message becomes the description) or a
// plain string. Centralizes the sonner dependency.
export const notify = {
  success: (title: string, description?: string) => toast.success(title, description ? { description } : undefined),
  error: (title: string, detail?: unknown) => {
    const description = describe(detail);
    return toast.error(title, description ? { description } : undefined);
  },
};
