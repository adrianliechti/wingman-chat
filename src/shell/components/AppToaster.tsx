import { Toaster } from "sonner";
import { useTheme } from "@/shell/hooks/useTheme";

// Themed to match the app's translucent/blur surfaces (see menuStyles/RewritePopover).
export function AppToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "!bg-white/80 dark:!bg-neutral-900/80 !backdrop-blur-xl !border !border-white/40 dark:!border-neutral-700/60 !rounded-xl !shadow-lg !shadow-black/20 dark:!shadow-black/50 !text-neutral-900 dark:!text-neutral-100",
          description: "!text-neutral-500 dark:!text-neutral-400",
          actionButton: "!bg-neutral-900 dark:!bg-neutral-100 !text-white dark:!text-neutral-900",
          cancelButton: "!bg-transparent !text-neutral-500",
        },
      }}
    />
  );
}
