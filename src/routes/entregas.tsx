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
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
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

  // pedido novo já nasce com a taxa da zona; o antigo, sem taxa, ainda cai
  // na tabela por bairro no despacho
  const feeOf = (o: { delivery_fee: number; neighborhood: string | null }) =>
    Number(o.delivery_fee) > 0
      ? Number(o.delivery_fee)
      : Number(fees.find((f) => f.neighborhood === o.neighborhood)?.amount ?? 0);

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
      actions={isAdmin ? <ZoneSettings /> : null}
    >
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
            const fee = openStops.reduce((s, o) => s + feeOf(o), 0);

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
    </AppShell>
  );
}

type Zone = {
  id: string;
  city: string;
  neighborhood: string | null;
  amount: number | null;
  serves: boolean;
};

/**
 * Taxas de entrega por cidade, com exceção por bairro. O valor é cobrado do
 * cliente no pedido e é o mesmo que o entregador recebe no acerto. Fica atrás
 * de um botão porque taxa muda pouco, e o quadro de despacho é usado o dia
 * inteiro.
 */
function ZoneSettings() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [novo, setNovo] = useState({ city: "", neighborhood: "", amount: "", serves: true });

  const { data: zones = [] } = useQuery({
    queryKey: ["delivery-zones"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_zones")
        .select("*")
        .order("city")
        .order("neighborhood", { nullsFirst: true });
      if (error) throw error;
      return data as Zone[];
    },
  });

  const cities = [...new Set(zones.map((z) => z.city))];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["delivery-zones"] });
    qc.invalidateQueries({ queryKey: ["delivery-quote"] });
  };

  const salvar = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; amount?: number; serves?: boolean }) => {
      const { error } = await supabase.from("delivery_zones").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Taxa atualizada");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adicionar = useMutation({
    mutationFn: async () => {
      const city = novo.city.trim();
      if (!city) throw new Error("Informe a cidade");
      if (novo.serves && novo.amount === "") throw new Error("Informe o valor da taxa");
      const { error } = await supabase.from("delivery_zones").insert({
        city,
        neighborhood: novo.neighborhood.trim() || null,
        amount: novo.serves ? Number(novo.amount) : null,
        serves: novo.serves,
      });
      if (error) {
        throw new Error(
          error.code === "23505" ? "Essa cidade/bairro já tem taxa cadastrada" : error.message,
        );
      }
    },
    onSuccess: () => {
      setNovo({ city: novo.city, neighborhood: "", amount: "", serves: true });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("delivery_zones").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Coins className="mr-1.5 size-3.5" /> Taxas de entrega
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Taxas de entrega</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Cobrada do cliente no pedido e paga ao entregador no acerto. O bairro listado vale no
          lugar do valor geral da cidade. Mudar a taxa não altera pedidos já criados.
        </p>

        <div className="space-y-4">
          {cities.map((city) => (
            <div key={city} className="rounded-md border border-border">
              <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-sm font-medium">
                {city}
              </p>
              <div className="divide-y divide-border">
                {zones
                  .filter((z) => z.city === city)
                  .map((z) => (
                    <div key={z.id} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="flex-1 text-sm">
                        {z.neighborhood ?? (
                          <span className="text-muted-foreground">Todos os bairros</span>
                        )}
                      </span>
                      {z.serves ? (
                        <Input
                          type="number"
                          step="0.01"
                          className="h-8 w-24"
                          defaultValue={z.amount ?? 0}
                          onBlur={(e) => {
                            const v = Number(e.target.value || 0);
                            if (v !== Number(z.amount)) salvar.mutate({ id: z.id, amount: v });
                          }}
                        />
                      ) : (
                        <Badge variant="destructive" className="text-[10px]">
                          Não atende
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => remover.mutate(z.id)}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
              </div>
            </div>
          ))}
          {zones.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhuma taxa cadastrada ainda.
            </p>
          )}
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <Label className="text-xs">Nova taxa</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Cidade"
              list="delivery-zone-cities"
              value={novo.city}
              onChange={(e) => setNovo({ ...novo, city: e.target.value })}
            />
            <datalist id="delivery-zone-cities">
              {cities.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Input
              placeholder="Bairro (vazio = cidade toda)"
              value={novo.neighborhood}
              onChange={(e) => setNovo({ ...novo, neighborhood: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={novo.serves ? "serves" : "no"}
              onValueChange={(v) => setNovo({ ...novo, serves: v === "serves" })}
            >
              <SelectTrigger className="h-9 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="serves">Atende</SelectItem>
                <SelectItem value="no">Não atende</SelectItem>
              </SelectContent>
            </Select>
            {novo.serves && (
              <Input
                type="number"
                step="0.01"
                placeholder="Taxa"
                className="w-24"
                value={novo.amount}
                onChange={(e) => setNovo({ ...novo, amount: e.target.value })}
              />
            )}
            <Button
              variant="outline"
              size="icon"
              disabled={adicionar.isPending}
              onClick={() => adicionar.mutate()}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
