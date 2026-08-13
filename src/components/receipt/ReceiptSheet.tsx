import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReactToPrint } from "react-to-print";
import { Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Receipt, type ReceiptItem, type ReceiptSale } from "@/components/receipt/Receipt";

export function ReceiptSheet({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const receiptRef = useRef<HTMLDivElement>(null);

  const { data: sale } = useQuery({
    queryKey: ["receipt-sale", saleId],
    enabled: !!saleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, customers(name)")
        .eq("id", saleId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["receipt-items", saleId],
    enabled: !!saleId,
    queryFn: async () => {
      const { data, error } = await supabase.from("sale_items").select("*").eq("sale_id", saleId!);
      if (error) throw error;
      return data;
    },
  });

  const receiptSale: ReceiptSale | null = useMemo(() => {
    if (!sale) return null;
    return {
      sale_number: sale.sale_number,
      created_at: sale.created_at,
      payment_method: sale.payment_method,
      discount: Number(sale.discount),
      subtotal: Number(sale.subtotal),
      total: Number(sale.total),
      neighborhood: sale.neighborhood,
      delivery_address: sale.delivery_address,
      customer_name: sale.customers?.name ?? null,
    };
  }, [sale]);

  const receiptItems: ReceiptItem[] = items.map((i) => ({
    id: i.id,
    product_name: i.product_name,
    quantity: i.quantity,
    unit_price: Number(i.unit_price),
    total: Number(i.total),
  }));

  // 80mm é a largura padrão de bobina térmica. O @page manda o navegador
  // usar esse tamanho de papel; o print-color-adjust garante que fundo e
  // linhas do recibo saiam na impressora mesmo com "gráficos de fundo"
  // desligado no driver.
  const print = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: receiptSale ? `Pedido ${receiptSale.sale_number}` : "Recibo",
    pageStyle: `
      @page { size: 80mm auto; margin: 0; }
      @media print {
        body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `,
  });

  const renderCanvas = async () => {
    if (!receiptRef.current) return null;
    const { default: html2canvas } = await import("html2canvas");
    return html2canvas(receiptRef.current, { backgroundColor: "#ffffff", scale: 2 });
  };

  const downloadImage = async () => {
    try {
      const canvas = await renderCanvas();
      if (!canvas) return;
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `recibo-pedido-${receiptSale?.sale_number ?? saleId}.png`;
      link.click();
    } catch {
      toast.error("Não foi possível gerar a imagem");
    }
  };

  const downloadPdf = async () => {
    try {
      const canvas = await renderCanvas();
      if (!canvas) return;
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({
        unit: "px",
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(`recibo-pedido-${receiptSale?.sale_number ?? saleId}.pdf`);
    } catch {
      toast.error("Não foi possível gerar o PDF");
    }
  };

  return (
    <Sheet open={!!saleId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>{receiptSale ? `Recibo — Pedido #${receiptSale.sale_number}` : "Recibo"}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto rounded-md border border-border py-4">
          {receiptSale ? (
            <Receipt ref={receiptRef} sale={receiptSale} items={receiptItems} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando recibo...</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-border pt-3">
          <Button variant="outline" size="sm" disabled={!receiptSale} onClick={downloadImage}>
            <Download className="mr-1.5 size-3.5" /> Imagem
          </Button>
          <Button variant="outline" size="sm" disabled={!receiptSale} onClick={downloadPdf}>
            <Download className="mr-1.5 size-3.5" /> PDF
          </Button>
          <Button size="sm" disabled={!receiptSale} onClick={() => print()}>
            <Printer className="mr-1.5 size-3.5" /> Imprimir
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
