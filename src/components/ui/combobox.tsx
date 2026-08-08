import { useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ComboboxOption = { value: string; label: string; keywords?: string };

/**
 * `footer` fica fora da lista filtrada do cmdk — é o lugar certo para uma
 * ação fixa tipo "+ Cadastrar novo", que precisa continuar visível mesmo
 * quando a busca não bate com nada.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Selecionar...",
  searchPlaceholder = "Buscar...",
  emptyMessage = "Nada encontrado.",
  footer,
}: {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.keywords ?? ""}`}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 size-4", value === o.value ? "opacity-100" : "opacity-0")}
                  />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {footer && (
            <div className="border-t border-border p-1" onClick={() => setOpen(false)}>
              {footer}
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
