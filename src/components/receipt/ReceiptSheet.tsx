import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReactToPrint } from "react-to-print";
import { Copy, Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePrintSettings, printPageStyle } from "@/hooks/use-print-settings";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Receipt, type ReceiptItem, type ReceiptSale } from "@/components/receipt/Receipt";
import { renderReceiptCanvas } from "@/components/receipt/receipt-canvas";
import { brl } from "@/lib/format";

// 1mm ~= 3.78px a 96dpi. "auto" (impressora comum) fica com uma largura de
// leitura confortável, sem forçar bobina estreita.
const widthPx = (paperWidth: "58mm" | "80mm" | "auto") =>
  paperWidth === "auto" ? 380 : Math.round(parseInt(paperWidth, 10) * 3.78);

export function ReceiptSheet({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const { settings } = usePrintSettings();
  const paperWidth = settings.printerType === "thermal" ? settings.paperWidth : "auto";

  const { data: sale } = useQuery({
    queryKey: ["receipt-sale", saleId],
    enabled: !!saleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, customers(name, phone, zip_code, reference_point, notes)")
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
    const subtotal = Number(sale.subtotal);
    const discount = Number(sale.discount);
    const total = Number(sale.total);
    return {
      sale_number: sale.sale_number,
      created_at: sale.created_at,
      // pagamento dividido na entrega: "pix R$ 60,00 + dinheiro R$ 40,00"
      payment_method: sale.payment_method_2
        ? `${sale.payment_method} ${brl(total - Number(sale.payment_amount_2))} + ${sale.payment_method_2} ${brl(Number(sale.payment_amount_2))}`
        : sale.payment_method,
      discount,
      subtotal,
      // taxa cobrada do cliente = o que o total tem a mais que os produtos.
      // pedido antigo guardava em delivery_fee só o pagamento do entregador,
      // sem somar no total — por isso não dá pra ler a coluna direto
      delivery_fee: Math.max(0, Math.round((total - Math.max(subtotal - discount, 0)) * 100) / 100),
      total,
      neighborhood: sale.neighborhood,
      delivery_address: sale.delivery_address,
      city: sale.city ?? null,
      // CEP, referência e observação de entrega vêm do cadastro do cliente;
      // a observação do pedido é a digitada no PDV
      zip_code: sale.customers?.zip_code ?? null,
      reference_point: sale.customers?.reference_point ?? null,
      delivery_notes: sale.customers?.notes ?? null,
      order_notes: sale.notes ?? null,
      customer_name: sale.customers?.name ?? null,
      customer_phone: sale.customers?.phone ?? null,
    };
  }, [sale]);

  const receiptItems: ReceiptItem[] = items.map((i) => ({
    id: i.id,
    product_name: i.product_name,
    quantity: i.quantity,
    unit_price: Number(i.unit_price),
    total: Number(i.total),
  }));

  const print = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: receiptSale ? `Pedido ${receiptSale.sale_number}` : "Recibo",
    pageStyle: printPageStyle(settings),
  });

  // Desenhado na mão no canvas (sem html2canvas): a hospedagem bloqueia
  // eval/new Function por política de segurança, e é exatamente isso que
  // qualquer lib de "fotografar o DOM" usa por baixo dos panos.
  const buildCanvas = () => {
    if (!receiptSale) return null;
    return renderReceiptCanvas(receiptSale, receiptItems, widthPx(paperWidth));
  };

  // agora que o canvas é desenhado na mão (sem html2canvas), copiar pra
  // área de transferência não esbarra mais no bloqueio de eval do CSP
  const copyImage = () => {
    try {
      const canvas = buildCanvas();
      if (!canvas) return;
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          toast.success("Recibo copiado");
        } catch (e) {
          console.error("copyImage", e);
          toast.error("Não foi possível copiar — seu navegador pode não suportar isso");
        }
      });
    } catch (e) {
      console.error("copyImage", e);
      toast.error("Não foi possível copiar o recibo");
    }
  };

  const downloadImage = () => {
    try {
      const canvas = buildCanvas();
      if (!canvas) return;
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `recibo-pedido-${receiptSale?.sale_number ?? saleId}.png`;
      link.click();
    } catch (e) {
      console.error("downloadImage", e);
      toast.error("Não foi possível gerar a imagem");
    }
  };

  const downloadPdf = async () => {
    try {
      const canvas = buildCanvas();
      if (!canvas) return;
      // Use the explicit browser build. The package root only exports Node and
      // browser conditions, so resolving `jspdf` during Worker SSR fails.
      const { jsPDF } = await import("jspdf/dist/jspdf.es.min.js");
      const pdf = new jsPDF({
        unit: "px",
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(`recibo-pedido-${receiptSale?.sale_number ?? saleId}.pdf`);
    } catch (e) {
      console.error("downloadPdf", e);
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
            <Receipt ref={receiptRef} sale={receiptSale} items={receiptItems} paperWidth={paperWidth} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando recibo...</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
          <Button variant="outline" size="sm" disabled={!receiptSale} onClick={copyImage}>
            <Copy className="mr-1.5 size-3.5" /> Copiar
          </Button>
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
