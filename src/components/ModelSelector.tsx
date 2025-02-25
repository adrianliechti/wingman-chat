"use client";

import { startTransition, useState } from "react";

import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { cn } from "@/lib/utils";
import { Model } from "@/models/chat";
import { ChevronDownIcon } from "lucide-react";

interface ModelSelectorProps {
  models: Model[];
  currentModel?: Model;
  onSelectModel: (model: Model) => void;
  className?: string;
}

export function ModelSelector({
  models,
  currentModel,
  onSelectModel,
  className,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        asChild
        className={cn(
          "w-fit data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
          className
        )}
      >
        <Button variant="outline" className="md:px-2 md:h-[34px]">
          {currentModel?.name ?? currentModel?.id ?? "Select Model"}
          <ChevronDownIcon className="h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[300px]">
        {models.map((model) => {
          return (
            <DropdownMenuItem
              key={model.id}
              onSelect={() => {
                setOpen(false);

                startTransition(() => {
                  onSelectModel(model);
                });
              }}
              className={cn(
                "flex flex-row items-center justify-between gap-4 group/item",
                model.id === currentModel?.id && "bg-muted"
              )}
              data-active={model.id === currentModel?.id}
            >
              <div className="flex flex-col items-start gap-1">
                <div>{model.name}</div>
                {/* <div className="text-xs text-muted-foreground">
                  {model.description ?? "New model"}
                </div> */}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
