import { useState } from "react";
import { Settings } from "lucide-react";
import { usePrintSettings, type PaperWidth, type PrinterType } from "@/hooks/use-print-settings";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Fica salvo só neste navegador (localStorage) — cada computador/celular
 * que imprime pode ter uma impressora diferente plugada.
 */
export function PrintSettingsDialog() {
  const { settings, update } = usePrintSettings();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" title="Configurar impressão">
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Configurações de impressão</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Label className="text-xs">Tipo de impressora</Label>
          <div className="space-y-2">
            {(
              [
                { v: "common", label: "Impressora comum" },
                { v: "thermal", label: "Impressora térmica" },
              ] as const
            ).map((t) => (
              <button
                key={t.v}
                onClick={() => update({ printerType: t.v as PrinterType })}
                className={`flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  settings.printerType === t.v
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted"
                }`}
              >
                <span
                  className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                    settings.printerType === t.v ? "border-primary" : "border-muted-foreground"
                  }`}
                >
                  {settings.printerType === t.v && <span className="size-2 rounded-full bg-primary" />}
                </span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {settings.printerType === "thermal" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Tamanho do papel</Label>
            <Select
              value={settings.paperWidth}
              onValueChange={(v) => update({ paperWidth: v as PaperWidth })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="58mm">58mm</SelectItem>
                <SelectItem value="80mm">80mm</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Essa configuração vale só para este dispositivo. Outros computadores/celulares não são
          afetados.
        </p>
      </DialogContent>
    </Dialog>
  );
}
