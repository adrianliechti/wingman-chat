import { UserRound } from "lucide-react";
import { cn } from "@/shared/lib/cn";

interface AvatarProps {
  name?: string;
  size?: number;
  className?: string;
}

function getInitials(name?: string): string {
  const tokens = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (tokens.length === 0) return "";
  const first = tokens[0][0];
  const last = tokens.length > 1 ? tokens[tokens.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, size = 28, className }: AvatarProps) {
  const initials = getInitials(name);

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 font-medium select-none",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {initials || <UserRound size={size * 0.6} />}
    </span>
  );
}
