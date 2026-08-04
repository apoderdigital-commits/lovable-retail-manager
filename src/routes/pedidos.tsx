import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Search, PackageCheck, RotateCcw, Ban, Eye } from "lucide-react";
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
import { brl } from "@/lib/format";
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

const FILTERS: { value: Status | "all"; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "new", label: "Novos" },
  { value: "picked", label: "Separados" },
  { value: "on_route", label: "Em rota" },
  { value: "scheduled", label: "Agendados" },
  { value: "not_delivered", label: "Não entregues" },
  { value: "delivered", label: "Entregues" },
  { value: "cancelled", label: "Cancelados" },
];

function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return <Badge className={`border-transparent ${s.className}`}>{s.label}</Badge>;
}

function OrdersPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Status | "all">("all");
  const [term, setTerm] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders", filter],
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select("*, customers(name, customer_type)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (filter !== "all") q = q.eq("status", filter);
      const { data, error } = await q;
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
    const name = o.customers?.name ?? "";
    return `${name} ${o.sale_number} ${o.neighborhood ?? ""}`
      .toLowerCase()
      .includes(term.toLowerCase());
  });

  const detail = orders.find((o) => o.id === detailId) ?? null;

  return (
    <AppShell
      title="Pedidos"
      subtitle={isLoading ? "Carregando..." : `${filtered.length} pedido(s)`}
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              filter === f.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Buscar por cliente, número do pedido ou bairro"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
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
                </TableCell>
                <TableCell className="text-muted-foreground">{o.neighborhood ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">{brl(Number(o.total))}</TableCell>
                <TableCell>
                  <StatusBadge status={o.status} />
                  {o.status === "scheduled" && o.scheduled_for && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      para {new Date(`${o.scheduled_for}T00:00:00`).toLocaleDateString("pt-BR")}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(o.created_at).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setDetailId(o.id)}>
                      <Eye className="size-4" />
                    </Button>

                    {o.status === "new" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={transition.isPending}
                        onClick={() => transition.mutate({ id: o.id, to: "picked" })}
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

                    {o.status !== "delivered" && o.status !== "cancelled" && (
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

      <OrderDetail sale={detail} onClose={() => setDetailId(null)} />
    </AppShell>
  );
}

function OrderDetail({
  sale,
  onClose,
}: {
  sale: { id: string; sale_number: number; total: number; reason: string | null } | null;
  onClose: () => void;
}) {
  const { data: items = [] } = useQuery({
    queryKey: ["order-items", sale?.id],
    enabled: !!sale,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_items")
        .select("*")
        .eq("sale_id", sale!.id);
      if (error) throw error;
      return data;
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["order-history", sale?.id],
    enabled: !!sale,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_status_history")
        .select("*")
        .eq("sale_id", sale!.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  return (
    <Dialog open={!!sale} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pedido {sale?.sale_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1">
          {items.map((i) => (
            <div key={i.id} className="flex justify-between text-sm">
              <span>
                {i.quantity}× {i.product_name}
              </span>
              <span className="text-muted-foreground">{brl(Number(i.total))}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-1.5 text-sm font-medium">
            <span>Total</span>
            <span>{brl(Number(sale?.total ?? 0))}</span>
          </div>
        </div>

        {sale?.reason && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Motivo: {sale.reason}
          </p>
        )}

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Histórico
          </p>
          <div className="space-y-1">
            {history.map((h) => (
              <div key={h.id} className="flex justify-between text-sm">
                <span>
                  {h.from_status ? `${STATUS[h.from_status].label} → ` : ""}
                  {STATUS[h.to_status].label}
                </span>
                <span className="text-muted-foreground">
                  {new Date(h.created_at).toLocaleString("pt-BR")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
