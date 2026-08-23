import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Ban,
  Banknote,
  CreditCard,
  MessageSquare,
  Printer,
  QrCode,
  Receipt as ReceiptIcon,
  Search,
  Store,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { brl, dateTime } from "@/lib/format";
import { ReceiptSheet } from "@/components/receipt/ReceiptSheet";

export const Route = createFileRoute("/vendas")({
  head: () => ({
    meta: [
      { title: "Histórico de Vendas — Vieira Perfumes" },
      {
        name: "description",
        content: "Todas as vendas registradas, com opção de cancelar e imprimir o recibo.",
      },
    ],
  }),
  component: SalesHistoryPage,
});

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
// segunda-feira como início da semana
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay();
  return addDays(x, day === 0 ? -6 : 1 - day);
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function paymentIcon(method: string) {
  const m = method.toLowerCase();
  if (m === "dinheiro") return Banknote;
  if (m === "pix") return QrCode;
  if (m === "boleto") return ReceiptIcon;
  return CreditCard;
}

function SalesHistoryPage() {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [printingId, setPrintingId] = useState<string | null>(null);

  const { data: sales = [], isLoading } = useQuery({
    queryKey: ["sales-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, customers(name, phone, customer_type)")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data;
    },
  });

  const saleIds = useMemo(() => sales.map((s) => s.id), [sales]);

  const { data: itemCounts = new Map<string, number>() } = useQuery({
    queryKey: ["sales-history-item-counts", saleIds],
    enabled: saleIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_items")
        .select("sale_id")
        .in("sale_id", saleIds);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data) map.set(row.sale_id, (map.get(row.sale_id) ?? 0) + 1);
      return map;
    },
  });

  const { data: sellers = [] } = useQuery({
    queryKey: ["profiles-sellers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, email");
      if (error) throw error;
      return data;
    },
  });
  const sellerMap = useMemo(
    () => new Map(sellers.map((p) => [p.id, p.full_name || p.email || "—"])),
    [sellers],
  );

  const transition = useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("transition_sale", {
        p_sale: input.id,
        p_to: "cancelled",
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venda cancelada");
      setCancelling(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["sales-history"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
    // a mensagem vem pronta do banco, em português
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = sales.filter((s) => {
    if (!term.trim()) return true;
    const name = s.customers?.name ?? "";
    const phone = s.customers?.phone ?? "";
    return `${name} ${phone} ${s.sale_number}`.toLowerCase().includes(term.toLowerCase());
  });

  const summary = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const yesterdayStart = addDays(todayStart, -1);
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);

    const bucket = (from: Date, to: Date) => {
      const list = sales.filter((s) => {
        if (s.status === "cancelled") return false;
        const t = new Date(s.created_at);
        return t >= from && t < to;
      });
      return { count: list.length, total: list.reduce((acc, s) => acc + Number(s.total), 0) };
    };

    return {
      hoje: bucket(todayStart, tomorrowStart),
      ontem: bucket(yesterdayStart, todayStart),
      semana: bucket(weekStart, tomorrowStart),
      mes: bucket(monthStart, tomorrowStart),
    };
  }, [sales]);

  return (
    <AppShell
      title="Histórico de Vendas"
      subtitle={isLoading ? "Carregando..." : `${filtered.length} venda(s)`}
    >
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-border bg-muted/40 px-4 py-3 text-sm">
          <SummaryStat label="Hoje" count={summary.hoje.count} total={summary.hoje.total} />
          <SummaryStat label="Ontem" count={summary.ontem.count} total={summary.ontem.total} />
          <SummaryStat label="Esta semana" count={summary.semana.count} total={summary.semana.total} />
          <SummaryStat label="Este mês" count={summary.mes.count} total={summary.mes.total} />
        </div>

        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            className="w-full max-w-xs bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Buscar por cliente, telefone ou número"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead>Itens</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-center">Tipo</TableHead>
              <TableHead className="text-center">Obs.</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((s) => {
              const PaymentIcon = paymentIcon(s.payment_method);
              const cancelled = s.status === "cancelled";
              const podeCancel = !cancelled && s.status !== "delivered";
              const items = itemCounts.get(s.id) ?? 0;

              return (
                <TableRow key={s.id} className={cancelled ? "opacity-50" : undefined}>
                  <TableCell className="font-medium">
                    #{s.sale_number}
                    {cancelled && (
                      <Badge variant="destructive" className="ml-2 align-middle text-[10px]">
                        Cancelada
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{dateTime(s.created_at)}</TableCell>
                  <TableCell>
                    <p className="font-medium">{s.customers?.name ?? "—"}</p>
                    {s.customers?.phone && (
                      <p className="text-xs text-muted-foreground">{s.customers.phone}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.seller_id ? (sellerMap.get(s.seller_id) ?? "—") : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {items} {items === 1 ? "item" : "itens"}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center justify-end gap-1.5 font-medium">
                      <PaymentIcon className="size-3.5 text-muted-foreground" />
                      {brl(Number(s.total))}
                    </span>
                  </TableCell>
                  <TableCell className="text-center" title={s.delivery_address ? "Entrega" : "Balcão"}>
                    {s.delivery_address ? (
                      <Truck className="mx-auto size-4 text-muted-foreground" />
                    ) : (
                      <Store className="mx-auto size-4 text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {s.reason ? (
                      <MessageSquare
                        className="mx-auto size-4 text-muted-foreground"
                        title={s.reason}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setPrintingId(s.id)}>
                        <Printer className="size-4" />
                      </Button>
                      {podeCancel && (
                        <Button variant="ghost" size="icon" onClick={() => setCancelling(s.id)}>
                          <Ban className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  Nenhuma venda encontrada.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!cancelling} onOpenChange={(v) => !v && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar venda</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O estoque reservado ou baixado volta a ficar disponível. Essa ação não pode ser desfeita.
          </p>
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Cliente desistiu, endereço errado, produto avariado..."
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelling(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || transition.isPending}
              onClick={() =>
                cancelling && transition.mutate({ id: cancelling, reason: reason.trim() })
              }
            >
              Cancelar venda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiptSheet saleId={printingId} onClose={() => setPrintingId(null)} />
    </AppShell>
  );
}

function SummaryStat({ label, count, total }: { label: string; count: number; total: number }) {
  return (
    <div>
      <span className="text-muted-foreground">
        {label}: {count} {count === 1 ? "venda" : "vendas"}
      </span>
      <p className="font-display font-semibold text-foreground">{brl(total)}</p>
    </div>
  );
}
