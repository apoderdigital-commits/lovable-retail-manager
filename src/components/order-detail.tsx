import { useQuery } from "@tanstack/react-query";
import { MapPin, MessageCircle, Package, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { brl, dateTimeFull } from "@/lib/format";
import type { Database } from "@/integrations/supabase/types";

type Status = Database["public"]["Enums"]["order_status"];

const STATUS_LABEL: Record<Status, string> = {
  new: "Novo",
  picked: "Separado",
  on_route: "Em rota",
  delivered: "Entregue",
  scheduled: "Agendado",
  not_delivered: "Não entregue",
  cancelled: "Cancelado",
};

// WhatsApp clicável: só dígitos, com 55 na frente quando vier sem DDI
const waLink = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`;
};

/**
 * Ficha completa do pedido — tudo que sai no recibo (cliente, WhatsApp,
 * endereço com CEP e referência, observações, itens e total de unidades),
 * pra quem separa conferir antes de mandar pra rota.
 */
export function OrderDetail({
  saleId,
  onClose,
  action,
}: {
  saleId: string | null;
  onClose: () => void;
  action?: { label: string; onClick: () => void; pending?: boolean } | undefined;
}) {
  const { data: sale } = useQuery({
    queryKey: ["order-detail", saleId],
    enabled: !!saleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, customers(name, phone, customer_type, zip_code, reference_point, notes)")
        .eq("id", saleId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["order-items", saleId],
    enabled: !!saleId,
    queryFn: async () => {
      const { data, error } = await supabase.from("sale_items").select("*").eq("sale_id", saleId!);
      if (error) throw error;
      return data;
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["order-history", saleId],
    enabled: !!saleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_status_history")
        .select("*")
        .eq("sale_id", saleId!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const c = sale?.customers;
  const units = items.reduce((s, i) => s + i.quantity, 0);
  const subtotal = Number(sale?.subtotal ?? 0);
  const discount = Number(sale?.discount ?? 0);
  const total = Number(sale?.total ?? 0);
  // mesma conta do recibo: taxa cobrada = o que o total tem a mais que os produtos
  const fee = Math.max(0, Math.round((total - Math.max(subtotal - discount, 0)) * 100) / 100);
  const deliveryNotes = sale?.delivery_address ? c?.notes : null;

  return (
    <Dialog open={!!saleId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pedido #{sale?.sale_number ?? ""}</DialogTitle>
        </DialogHeader>

        {!sale ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <div className="space-y-4 text-sm">
            <section className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="font-medium">{c?.name ?? "Consumidor final"}</p>
                {c?.customer_type === "wholesale" && <Badge variant="secondary">Atacado</Badge>}
              </div>
              {c?.phone && (
                <a
                  href={waLink(c.phone)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-success"
                >
                  <MessageCircle className="size-4" /> {c.phone}
                </a>
              )}
            </section>

            <section className="rounded-md border border-border p-3">
              {sale.delivery_address ? (
                <div className="flex gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      {sale.delivery_address}
                      {sale.neighborhood ? ` - ${sale.neighborhood}` : ""}
                    </p>
                    {(sale.city || c?.zip_code) && (
                      <p className="text-muted-foreground">
                        {[sale.city, c?.zip_code ? `CEP ${c.zip_code}` : null]
                          .filter(Boolean)
                          .join(" - ")}
                      </p>
                    )}
                    {c?.reference_point && (
                      <p className="text-muted-foreground">Ref.: {c.reference_point}</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Store className="size-4" /> Retirada no balcão
                </p>
              )}
            </section>

            {(deliveryNotes || sale.notes) && (
              <section className="space-y-1 rounded-md border-2 border-dashed border-foreground/40 p-3">
                {deliveryNotes && (
                  <p>
                    <span className="font-medium">Obs. entrega:</span> {deliveryNotes}
                  </p>
                )}
                {sale.notes && (
                  <p>
                    <span className="font-medium">Obs. pedido:</span> {sale.notes}
                  </p>
                )}
              </section>
            )}

            <section>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Package className="size-3.5" /> Itens para separar
              </p>
              <div className="divide-y divide-border rounded-md border border-border">
                {items.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-10 shrink-0 text-right font-display text-lg font-semibold">
                      {i.quantity}×
                    </span>
                    <span className="flex-1">{i.product_name}</span>
                    <span className="text-muted-foreground">{brl(Number(i.total))}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 space-y-0.5">
                <div className="flex justify-between font-medium">
                  <span>Total de unidades</span>
                  <span>{units}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{brl(subtotal)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Desconto</span>
                    <span>-{brl(discount)}</span>
                  </div>
                )}
                {fee > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Taxa de entrega</span>
                    <span>{brl(fee)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border pt-1 font-semibold">
                  <span>Total</span>
                  <span>{brl(total)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Pagamento</span>
                  <span className="text-right">
                    {sale.payment_method_2
                      ? `${sale.payment_method} ${brl(total - Number(sale.payment_amount_2))} + ${sale.payment_method_2} ${brl(Number(sale.payment_amount_2))}`
                      : sale.payment_method}
                  </span>
                </div>
              </div>
            </section>

            {sale.reason && (
              <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
                Motivo: {sale.reason}
              </p>
            )}

            <section>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Histórico
              </p>
              <div className="space-y-1">
                {history.map((h) => (
                  <div key={h.id} className="flex justify-between">
                    <span>
                      {h.from_status ? `${STATUS_LABEL[h.from_status]} → ` : ""}
                      {STATUS_LABEL[h.to_status]}
                    </span>
                    <span className="text-muted-foreground">
                      {dateTimeFull(h.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {action && sale && (
          <DialogFooter>
            <Button className="w-full" size="lg" disabled={action.pending} onClick={action.onClick}>
              {action.label}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
