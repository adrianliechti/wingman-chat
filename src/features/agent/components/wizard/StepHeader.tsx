interface StepHeaderProps {
  title: string;
  description: string;
}

export function StepHeader({ title, description }: StepHeaderProps) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{description}</p>
    </div>
  );
}
