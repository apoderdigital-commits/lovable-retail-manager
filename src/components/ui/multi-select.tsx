import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type MultiSelectOption = { value: string; label: string };

const CheckBox = ({ checked }: { checked: boolean }) => (
  <span
    className={cn(
      "flex size-4 shrink-0 items-center justify-center rounded-sm border border-primary",
      checked && "bg-primary text-primary-foreground",
    )}
  >
    {checked && <Check className="size-3" />}
  </span>
);

/**
 * Dropdown com checkbox pra marcar vários ao mesmo tempo — usado no filtro
 * de categoria do PDV e no filtro de status de Pedidos. Vazio (nada
 * marcado) sempre significa "todos", pra não exigir um clique extra no caso
 * mais comum.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  allLabel = "Todos",
  icon,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  allLabel?: string;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? placeholder)
        : `${selected.length} selecionados`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          {icon}
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <button
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
          onClick={() => onChange([])}
        >
          <CheckBox checked={selected.length === 0} />
          {allLabel}
        </button>
        <div className="my-1 border-t border-border" />
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.value}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => toggle(o.value)}
            >
              <CheckBox checked={selected.includes(o.value)} />
              <span className="truncate">{o.label}</span>
            </button>
          ))}
          {options.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nada pra escolher.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
