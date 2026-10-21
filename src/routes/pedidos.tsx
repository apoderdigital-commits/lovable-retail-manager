import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Search, PackageCheck, RotateCcw, Ban, Eye, Printer, ListFilter } from "lucide-react";
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
import { brl, dateBr, dayBr } from "@/lib/format";
import { ReceiptSheet } from "@/components/receipt/ReceiptSheet";
import { PrintSettingsDialog } from "@/components/print-settings-dialog";
import { MultiSelect } from "@/components/ui/multi-select";
import { OrderDetail } from "@/components/order-detail";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

type Status = Database["public"]["Enums"]["order_status"];

export const Route = createFileRoute("/pedidos")({
  head: () => ({
    meta: [
      { title: "Pedidos — Vieira Perfumes" },
      {
        name: "description",
        content: "Acompanhe os pedidos por status, separe para entrega e cancele quando preciso.",
      },
    ],
  }),
  component: OrdersPage,
});

const STATUS: Record<Status, { label: string; className: string }> = {
  new: { label: "Novo", className: "bg-accent text-accent-foreground" },
  picked: { label: "Separado", className: "bg-secondary text-secondary-foreground" },
  on_route: { label: "Em rota", className: "bg-primary text-primary-foreground" },
  delivered: { label: "Entregue", className: "bg-success text-success-foreground" },
  scheduled: { label: "Agendado", className: "bg-warning text-warning-foreground" },
  not_delivered: { label: "Não entregue", className: "bg-warning text-warning-foreground" },
  cancelled: { label: "Cancelado", className: "bg-destructive text-destructive-foreground" },
};

const STATUS_OPTIONS = Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }));

function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return <Badge className={`border-transparent ${s.className}`}>{s.label}</Badge>;
}

function OrdersPage() {
  const qc = useQueryClient();
  const { isAdmin, user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [term, setTerm] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, customers(name, customer_type)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const transition = useMutation({
    mutationFn: async (input: { id: string; to: Status; reason?: string }) => {
      const { error } = await supabase.rpc("transition_sale", {
        p_sale: input.id,
        p_to: input.to,
        ...(input.reason ? { p_reason: input.reason } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido atualizado");
      setCancelling(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    // a mensagem vem pronta do banco, em português
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = orders.filter((o) => {
    if (statusFilter.length > 0 && !statusFilter.includes(o.status)) return false;
    const name = o.customers?.name ?? "";
    return `${name} ${o.sale_number} ${o.neighborhood ?? ""}`
      .toLowerCase()
      .includes(term.toLowerCase());
  });

  return (
    <AppShell
      title="Pedidos"
      subtitle={isLoading ? "Carregando..." : `${filtered.length} pedido(s)`}
      actions={<PrintSettingsDialog />}
    >
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-40 flex-1 items-center gap-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Buscar por cliente, número do pedido ou bairro"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>
          <MultiSelect
            options={STATUS_OPTIONS}
            selected={statusFilter}
            onChange={setStatusFilter}
            placeholder="Status"
            allLabel="Todos os status"
            icon={<ListFilter className="size-3.5" />}
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Nº</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Bairro</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Criado</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="text-muted-foreground">{o.sale_number}</TableCell>
                <TableCell>
                  <p className="font-medium">{o.customers?.name ?? "—"}</p>
                  {o.customers?.customer_type === "wholesale" && (
                    <p className="text-xs text-muted-foreground">Atacado</p>
                  )}
                  {o.notes && (
                    <p className="max-w-56 truncate text-xs text-muted-foreground" title={o.notes}>
                      Obs.: {o.notes}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{o.neighborhood ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">{brl(Number(o.total))}</TableCell>
                <TableCell>
                  <StatusBadge status={o.status} />
                  {o.status === "scheduled" && o.scheduled_for && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      para {dayBr(o.scheduled_for)}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {dateBr(o.created_at)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setDetailId(o.id)}>
                      <Eye className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setPrintingId(o.id)}>
                      <Printer className="size-4" />
                    </Button>

                    {o.status === "new" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={transition.isPending}
                        onClick={() => setPickingId(o.id)}
                      >
                        <PackageCheck className="mr-1.5 size-4" /> Separar
                      </Button>
                    )}

                    {(o.status === "scheduled" || o.status === "not_delivered") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={transition.isPending}
                        onClick={() => transition.mutate({ id: o.id, to: "picked" })}
                      >
                        <RotateCcw className="mr-1.5 size-4" /> Voltar pra fila
                      </Button>
                    )}

                    {/* pedido de entrega só admin cancela; balcão, quem vendeu */}
                    {o.status !== "delivered" &&
                      o.status !== "cancelled" &&
                      (isAdmin || (!o.delivery_address && o.seller_id === user?.id)) && (
                      <Button variant="ghost" size="icon" onClick={() => setCancelling(o.id)}>
                        <Ban className="size-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Nenhum pedido aqui.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!cancelling} onOpenChange={(v) => !v && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar pedido</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O estoque reservado volta a ficar disponível. Pedido já em rota só pode ser cancelado
            por administrador.
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
                cancelling &&
                transition.mutate({ id: cancelling, to: "cancelled", reason: reason.trim() })
              }
            >
              Cancelar pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* "Separar" abre a ficha completa: quem separa confere itens, endereço,
          WhatsApp e observações antes de confirmar */}
      <OrderDetail
        saleId={pickingId ?? detailId}
        onClose={() => {
          setPickingId(null);
          setDetailId(null);
        }}
        action={
          pickingId
            ? {
                label: "Confirmar separação",
                pending: transition.isPending,
                onClick: () =>
                  transition.mutate(
                    { id: pickingId, to: "picked" },
                    { onSuccess: () => setPickingId(null) },
                  ),
              }
            : undefined
        }
      />
      <ReceiptSheet saleId={printingId} onClose={() => setPrintingId(null)} />
    </AppShell>
  );
}
