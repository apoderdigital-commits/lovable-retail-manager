import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bike,
  Send,
  Undo2,
  CalendarClock,
  Flag,
  Coins,
  Plus,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Metric } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/entregas")({
  head: () => ({
    meta: [
      { title: "Entregas — Vieira Perfumes" },
      {
        name: "description",
        content: "Monte as rotas do dia, distribua os pedidos entre os entregadores e despache.",
      },
    ],
  }),
  component: DeliveriesPage,
});

type RouteSummary = {
  route_id: string;
  courier_id: string;
  dispatched_at: string | null;
  closed_at: string | null;
  stops: number;
  delivered: number;
  not_delivered: number;
  pending: number;
  fee_payable: number;
  cash_collected: number;
};

type RangeSummary = {
  courier_id: string;
  stops: number;
  delivered: number;
  not_delivered: number;
  pending: number;
  fee_payable: number;
  cash_collected: number;
};

type PaymentBreakdown = {
  courier_id: string;
  payment_method: string;
  transactions: number;
  amount: number;
};

// data local no formato YYYY-MM-DD, sem escorregar de fuso
const todayISO = () => new Date().toLocaleDateString("sv-SE");

function DeliveriesPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const today = todayISO();
  const [closing, setClosing] = useState<string | null>(null);

  const { data: couriers = [] } = useQuery({
    queryKey: ["couriers"],
    queryFn: async () => {
      const { data: roles, error } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "courier");
      if (error) throw error;
      const ids = roles.map((r) => r.user_id);
      if (ids.length === 0) return [];
      const { data: people, error: e2 } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      if (e2) throw e2;
      return people;
    },
  });

  // rotas de hoje mais qualquer uma ainda aberta de dias anteriores,
  // para não sumir com rota esquecida na virada
  const { data: routes = [] } = useQuery({
    queryKey: ["routes", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("routes")
        .select("*")
        .or(`date.eq.${today},closed_at.is.null`)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const { data: fees = [] } = useQuery({
    queryKey: ["delivery-fees"],
    queryFn: async () => {
      const { data, error } = await supabase.from("delivery_fees").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["dispatch", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, customers(name, customer_type)")
        .in("status", ["picked", "scheduled", "on_route"])
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  // as entregas já concluídas não estão em `orders`, que só traz pedido
  // em aberto. o resumo vem fechado do banco.
  const { data: summary = [] } = useQuery({
    queryKey: ["route-summary", today],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("route_day_summary", { p_date: today });
      if (error) throw error;
      return (data ?? []) as RouteSummary[];
    },
  });

  const summaryOf = (routeId: string) => summary.find((r) => r.route_id === routeId) ?? null;

  const dia = summary.reduce(
    (acc, r) => ({
      corridas: acc.corridas + Number(r.delivered),
      falhas: acc.falhas + Number(r.not_delivered),
      naRua: acc.naRua + Number(r.pending),
      taxa: acc.taxa + Number(r.fee_payable),
      especie: acc.especie + Number(r.cash_collected),
    }),
    { corridas: 0, falhas: 0, naRua: 0, taxa: 0, especie: 0 },
  );

  const feeOf = (neighborhood: string | null) =>
    Number(fees.find((f) => f.neighborhood === neighborhood)?.amount ?? 0);

  const queue = orders.filter((o) => o.status === "picked" && !o.route_id);
  const scheduledToday = orders.filter(
    (o) => o.status === "scheduled" && o.scheduled_for && o.scheduled_for <= today,
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dispatch"] });
    qc.invalidateQueries({ queryKey: ["routes"] });
    qc.invalidateQueries({ queryKey: ["route-summary"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const assign = useMutation({
    mutationFn: async ({ saleId, courierId }: { saleId: string; courierId: string }) => {
      // a função devolve a rota em montagem do entregador, criando se
      // não houver. no banco para não haver corrida entre atendentes.
      const { data: routeId, error } = await supabase.rpc("open_route_for", {
        p_courier: courierId,
      });
      if (error) throw error;
      const { error: e2 } = await supabase
        .from("sales")
        .update({ route_id: routeId })
        .eq("id", saleId);
      if (e2) throw e2;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const unassign = useMutation({
    mutationFn: async (saleId: string) => {
      const { error } = await supabase.from("sales").update({ route_id: null }).eq("id", saleId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const backToQueue = useMutation({
    mutationFn: async (saleId: string) => {
      const { error } = await supabase.rpc("transition_sale", {
        p_sale: saleId,
        p_to: "picked",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido de volta na fila");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dispatch = useMutation({
    mutationFn: async (routeId: string) => {
      const { data, error } = await supabase.rpc("dispatch_route", { p_route: routeId });
      if (error) throw error;
      return data;
    },
    onSuccess: (n) => {
      toast.success(`${n} pedido(s) despachado(s). Já aparecem no celular do entregador.`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const close = useMutation({
    mutationFn: async (routeId: string) => {
      const { data, error } = await supabase.rpc("close_route", { p_route: routeId });
      if (error) throw error;
      return data as Record<string, number>;
    },
    onSuccess: (r) => {
      setClosing(null);
      toast.success(
        `Rota encerrada — ${r["delivered"]} entregue(s), taxa de ${brl(Number(r["fee_payable"]))}. ` +
          `Dinheiro a acertar: ${brl(Number(r["cash_in_hand"]))}.`,
        { duration: 10000 },
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stopsOf = (routeId: string) => orders.filter((o) => o.route_id === routeId);

  return (
    <AppShell
      title="Entregas"
      subtitle={new Date().toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })}
      actions={
        isAdmin ? (
          <FeeSettings
            fees={fees}
            neighborhoods={[
              ...new Set(orders.map((o) => o.neighborhood).filter((b): b is string => !!b)),
            ]}
          />
        ) : null
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Corridas entregues"
          value={String(dia.corridas)}
          hint={dia.falhas > 0 ? `${dia.falhas} não entregue(s)` : "no dia de hoje"}
        />
        <Metric
          label="Taxa a pagar"
          value={brl(dia.taxa)}
          tone="accent"
          hint="só entregas concluídas"
        />
        <Metric
          label="Dinheiro a acertar"
          value={brl(dia.especie)}
          hint="recebido em espécie"
        />
        <Metric
          label="Ainda na rua"
          value={String(dia.naRua)}
          tone={dia.naRua > 0 ? "warning" : "default"}
          hint="paradas pendentes"
        />
      </div>

      {couriers.length === 0 && (
        <div className="panel mb-4 p-4 text-sm text-muted-foreground">
          Nenhum entregador cadastrado. Crie o acesso em Usuários com o papel Entregador.
        </div>
      )}

      {scheduledToday.length > 0 && (
        <div className="panel mb-4 border-warning/40 p-4">
          <div className="mb-2 flex items-center gap-2">
            <CalendarClock className="size-4 text-warning" />
            <p className="text-sm font-medium">
              {scheduledToday.length} pedido(s) agendado(s) para hoje ou antes
            </p>
          </div>
          <div className="space-y-1.5">
            {scheduledToday.map((o) => (
              <div key={o.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">
                  #{o.sale_number} {o.customers?.name} · {o.neighborhood ?? "sem bairro"}
                </span>
                <Button size="sm" variant="outline" onClick={() => backToQueue.mutate(o.id)}>
                  <Undo2 className="mr-1.5 size-3.5" /> Pra fila
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section className="panel h-fit">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Fila · separados</h2>
            <Badge variant="secondary">{queue.length}</Badge>
          </header>
          <div className="space-y-2 p-3">
            {queue.map((o) => (
              <article key={o.id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{o.customers?.name ?? "Consumidor final"}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant="secondary" className="text-[10px]">
                      #{o.sale_number}
                    </Badge>
                    {o.customers?.customer_type === "wholesale" && (
                      <Badge variant="secondary" className="text-[10px]">
                        atacado
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {o.neighborhood ?? "sem bairro"} · {o.payment_method}
                </p>
                <p className="mt-1 text-sm font-medium">{brl(Number(o.total))}</p>
                <Select
                  disabled={couriers.length === 0 || assign.isPending}
                  onValueChange={(courierId) => assign.mutate({ saleId: o.id, courierId })}
                >
                  <SelectTrigger className="mt-2 h-8 text-xs">
                    <SelectValue placeholder="Atribuir a..." />
                  </SelectTrigger>
                  <SelectContent>
                    {couriers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name || c.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </article>
            ))}
            {queue.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nada separado no momento.
              </p>
            )}
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {couriers.map((c) => {
            const mine = routes.filter((r) => r.courier_id === c.id);
            const open = mine.find((r) => !r.dispatched_at) ?? null;
            const running = mine.filter((r) => r.dispatched_at && !r.closed_at);
            const openStops = open ? stopsOf(open.id) : [];
            const cash = openStops
              .filter((o) => o.payment_method === "dinheiro")
              .reduce((s, o) => s + Number(o.total), 0);
            const fee = openStops.reduce((s, o) => s + feeOf(o.neighborhood), 0);

            return (
              <section key={c.id} className="panel flex flex-col">
                <header className="border-b border-border px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Bike className="size-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">{c.full_name || c.email}</span>
                    {running.length > 0 && (
                      <Badge className="ml-auto border-transparent bg-primary text-[10px] text-primary-foreground">
                        {running.length} na rua
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {openStops.length} em montagem · espécie {brl(cash)} · taxa {brl(fee)}
                  </p>
                </header>

                <div className="flex-1 space-y-1.5 p-3">
                  {openStops.map((o, idx) => (
                    <div
                      key={o.id}
                      className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2"
                    >
                      <span className="text-xs text-muted-foreground">{idx + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{o.customers?.name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {o.neighborhood ?? "sem bairro"}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        #{o.sale_number}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => unassign.mutate(o.id)}
                      >
                        <Undo2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  {openStops.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      Atribua pedidos da fila para montar a próxima saída.
                    </p>
                  )}
                </div>

                <div className="space-y-2 border-t border-border p-3">
                  <Button
                    className="w-full"
                    size="sm"
                    disabled={!open || openStops.length === 0 || dispatch.isPending}
                    onClick={() => open && dispatch.mutate(open.id)}
                  >
                    <Send className="mr-1.5 size-3.5" /> Despachar saída
                  </Button>

                  {running.map((r) => {
                    const sm = summaryOf(r.id);
                    const hora = r.dispatched_at
                      ? new Date(r.dispatched_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "";
                    return closing === r.id ? (
                      <div key={r.id} className="space-y-1.5 rounded-md bg-muted/50 p-2">
                        <p className="text-xs text-muted-foreground">
                          Encerra o acerto desta saída. Paradas não concluídas ficam como estão.
                        </p>
                        <div className="flex gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1"
                            onClick={() => setClosing(null)}
                          >
                            Voltar
                          </Button>
                          <Button
                            size="sm"
                            className="flex-1"
                            disabled={close.isPending}
                            onClick={() => close.mutate(r.id)}
                          >
                            Confirmar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div key={r.id} className="rounded-md border border-border">
                        <div className="flex items-baseline justify-between px-2.5 pt-2 text-xs">
                          <span className="font-medium">Saída das {hora}</span>
                          <span className="text-muted-foreground">
                            {sm ? `${sm.delivered}/${sm.stops}` : "—"} entregue(s)
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between px-2.5 pb-2 text-xs text-muted-foreground">
                          <span>taxa {brl(Number(sm?.fee_payable ?? 0))}</span>
                          <span>espécie {brl(Number(sm?.cash_collected ?? 0))}</span>
                        </div>
                        <Button
                          variant="ghost"
                          className="w-full rounded-t-none border-t border-border"
                          size="sm"
                          onClick={() => setClosing(r.id)}
                        >
                          <Flag className="mr-1.5 size-3.5" /> Encerrar saída
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <PeriodSummary couriers={couriers} />
    </AppShell>
  );
}

/**
 * Fila e saídas em andamento são sempre "hoje" — despachar um pedido de
 * outro dia não faz sentido. Já este resumo é histórico e filtrável, por
 * isso mora numa seção separada com o próprio controle de período.
 */
function PeriodSummary({
  couriers,
}: {
  couriers: { id: string; full_name: string | null; email: string }[];
}) {
  const [from, setFrom] = useState(todayISO);
  const [to, setTo] = useState(todayISO);

  const { data: range = [] } = useQuery({
    queryKey: ["route-range-summary", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("route_range_summary", { p_from: from, p_to: to });
      if (error) throw error;
      return (data ?? []) as RangeSummary[];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["route-payment-breakdown", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("route_payment_breakdown", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as PaymentBreakdown[];
    },
  });

  const totals = range.reduce(
    (acc, r) => ({
      delivered: acc.delivered + Number(r.delivered),
      notDelivered: acc.notDelivered + Number(r.not_delivered),
      fee: acc.fee + Number(r.fee_payable),
    }),
    { delivered: 0, notDelivered: 0, fee: 0 },
  );
  const apurado = payments.reduce((s, p) => s + Number(p.amount), 0);

  const nameOf = (id: string) => {
    const c = couriers.find((x) => x.id === id);
    return c?.full_name || c?.email || "—";
  };

  return (
    <section className="panel mt-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Resumo do período</h2>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">De</Label>
            <Input
              type="date"
              className="h-8"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Até</Label>
            <Input type="date" className="h-8" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </header>

      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Entregues" value={String(totals.delivered)} />
        <Metric
          label="Não entregues"
          value={String(totals.notDelivered)}
          tone={totals.notDelivered > 0 ? "warning" : "default"}
        />
        <Metric label="Taxa total" value={brl(totals.fee)} tone="accent" />
        <Metric label="Total apurado" value={brl(apurado)} hint="todas as formas de pagamento" />
      </div>

      <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2 xl:grid-cols-3">
        {range.map((r) => {
          const meus = payments.filter((p) => p.courier_id === r.courier_id);
          const meuApurado = meus.reduce((s, p) => s + Number(p.amount), 0);
          return (
            <div key={r.courier_id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">{nameOf(r.courier_id)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {r.delivered} entregue(s) · taxa {brl(Number(r.fee_payable))}
              </p>
              <div className="mt-2 space-y-1">
                {meus.map((p) => (
                  <div key={p.payment_method} className="flex justify-between text-xs">
                    <span className="capitalize text-muted-foreground">
                      {p.payment_method} · {p.transactions}x
                    </span>
                    <span className="font-medium">{brl(Number(p.amount))}</span>
                  </div>
                ))}
                {meus.length === 0 && (
                  <p className="text-xs text-muted-foreground">Sem entregas no período.</p>
                )}
              </div>
              <div className="mt-2 flex justify-between border-t border-border pt-1.5 text-xs font-semibold">
                <span>Apurado</span>
                <span>{brl(meuApurado)}</span>
              </div>
            </div>
          );
        })}
        {range.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
            Nenhum motoboy com rota no período.
          </p>
        )}
      </div>
    </section>
  );
}

type Fee = { id: string; neighborhood: string; amount: number };

/**
 * Taxas por bairro. Fica atrás de um botão porque taxa muda uma vez por
 * mês, e o quadro de despacho é usado o dia inteiro.
 */
function FeeSettings({ fees, neighborhoods }: { fees: Fee[]; neighborhoods: string[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [novo, setNovo] = useState({ neighborhood: "", amount: "" });

  // bairro que tem pedido mas não tem taxa: o entregador receberia zero
  // por essa parada e ninguém perceberia até o acerto do fim do dia
  const semTaxa = neighborhoods.filter((b) => !fees.some((f) => f.neighborhood === b));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["delivery-fees"] });
    qc.invalidateQueries({ queryKey: ["finance"] });
  };

  const salvar = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number }) => {
      const { error } = await supabase.from("delivery_fees").update({ amount: value }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Taxa atualizada");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adicionar = useMutation({
    mutationFn: async (bairro?: string) => {
      const nome = (bairro ?? novo.neighborhood).trim();
      if (!nome) throw new Error("Informe o bairro");
      const { error } = await supabase
        .from("delivery_fees")
        .insert({ neighborhood: nome, amount: Number(novo.amount || 0) });
      if (error) throw error;
    },
    onSuccess: () => {
      setNovo({ neighborhood: "", amount: "" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("delivery_fees").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Coins className="mr-1.5 size-3.5" /> Taxas por bairro
          {semTaxa.length > 0 && (
            <Badge className="ml-2 border-transparent bg-warning text-[10px] text-warning-foreground">
              {semTaxa.length}
            </Badge>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Taxas de entrega</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          O valor é aplicado no despacho, conforme o bairro do pedido. Depois de despachada, a rota
          mantém a taxa que valia naquele momento.
        </p>

        {semTaxa.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 text-warning" />
              <p className="text-xs font-medium">Bairro com pedido e sem taxa</p>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              Essas entregas sairiam pagando zero ao entregador.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {semTaxa.map((b) => (
                <Button
                  key={b}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => adicionar.mutate(b)}
                >
                  <Plus className="mr-1 size-3" /> {b}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {fees.map((f) => (
            <div key={f.id} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">{f.neighborhood}</Label>
                <Input
                  type="number"
                  step="0.01"
                  defaultValue={f.amount}
                  onBlur={(e) => {
                    const v = Number(e.target.value || 0);
                    if (v !== Number(f.amount)) salvar.mutate({ id: f.id, value: v });
                  }}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="mb-0.5"
                onClick={() => remover.mutate(f.id)}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
          {fees.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhuma taxa cadastrada ainda.
            </p>
          )}
        </div>

        <div className="flex items-end gap-2 border-t border-border pt-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">Novo bairro</Label>
            <Input
              placeholder="Centro"
              value={novo.neighborhood}
              onChange={(e) => setNovo({ ...novo, neighborhood: e.target.value })}
            />
          </div>
          <div className="w-24 space-y-1.5">
            <Label className="text-xs">Taxa</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="0,00"
              value={novo.amount}
              onChange={(e) => setNovo({ ...novo, amount: e.target.value })}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            className="mb-0.5"
            disabled={adicionar.isPending}
            onClick={() => adicionar.mutate(undefined)}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
