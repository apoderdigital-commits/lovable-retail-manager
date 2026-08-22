import { useEffect, useState } from "react";

export type PrinterType = "common" | "thermal";
export type PaperWidth = "58mm" | "80mm";

export type PrintSettings = {
  printerType: PrinterType;
  paperWidth: PaperWidth;
};

const STORAGE_KEY = "print-settings";
const DEFAULT_SETTINGS: PrintSettings = { printerType: "thermal", paperWidth: "80mm" };

const read = (): PrintSettings => {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

/**
 * Config de impressão por dispositivo (localStorage, não banco) — cada
 * computador/celular que imprime pode ter uma impressora diferente
 * plugada, então não faz sentido compartilhar isso entre usuários.
 */
export function usePrintSettings() {
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(read());
  }, []);

  const update = (next: Partial<PrintSettings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...next };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      return merged;
    });
  };

  return { settings, update };
}

// impressora comum não recebe @page size: deixa o driver/SO decidir o
// papel, em vez de forçar bobina estreita numa folha A4
export function printPageStyle(settings: PrintSettings) {
  const size = settings.printerType === "thermal" ? `@page { size: ${settings.paperWidth} auto; margin: 0; }` : "";
  return `
    ${size}
    @media print {
      body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;
}
