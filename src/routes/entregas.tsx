import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bike, Send, Undo2, CalendarClock, Flag } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

// data local no formato YYYY-MM-DD, sem escorregar de fuso
const todayISO = () => new Date().toLocaleDateString("sv-SE");

function DeliveriesPage() {
  const qc = useQueryClient();
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

  const { data: routes = [] } = useQuery({
    queryKey: ["routes", today],
    queryFn: async () => {
      const { data, error } = await supabase.from("routes").select("*").eq("date", today);
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
        .in("status", ["picked", "scheduled"])
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const feeOf = (neighborhood: string | null) =>
    Number(fees.find((f) => f.neighborhood === neighborhood)?.amount ?? 0);

  const queue = orders.filter((o) => o.status === "picked" && !o.route_id);
  const scheduledToday = orders.filter(
    (o) => o.status === "scheduled" && o.scheduled_for && o.scheduled_for <= today,
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dispatch"] });
    qc.invalidateQueries({ queryKey: ["routes"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const assign = useMutation({
    mutationFn: async ({ saleId, courierId }: { saleId: string; courierId: string }) => {
      // a rota do dia do entregador é criada na primeira atribuição
      const { data: route, error } = await supabase
        .from("routes")
        .upsert({ courier_id: courierId, date: today }, { onConflict: "courier_id,date" })
        .select()
        .single();
      if (error) throw error;
      if (route.dispatched_at) throw new Error("Rota já despachada. Crie o pedido na próxima.");
      const { error: e2 } = await supabase
        .from("sales")
        .update({ route_id: route.id })
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

  return (
    <AppShell
      title="Entregas"
      subtitle={new Date().toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })}
    >
      {couriers.length === 0 && (
        <div className="panel mb-4 p-4 text-sm text-muted-foreground">
          Nenhum entregador cadastrado. Um usuário vira entregador ao receber o papel{" "}
          <code className="rounded bg-muted px-1">courier</code> em <code>user_roles</code>.
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
                  {o.customers?.customer_type === "wholesale" && (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      atacado
                    </Badge>
                  )}
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
            const route = routes.find((r) => r.courier_id === c.id);
            const stops = route ? orders.filter((o) => o.route_id === route.id) : [];
            const cash = stops
              .filter((o) => o.payment_method === "dinheiro")
              .reduce((s, o) => s + Number(o.total), 0);
            const fee = stops.reduce((s, o) => s + feeOf(o.neighborhood), 0);
            const dispatched = !!route?.dispatched_at;

            return (
              <section key={c.id} className="panel flex flex-col">
                <header className="border-b border-border px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Bike className="size-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">{c.full_name || c.email}</span>
                    {dispatched && (
                      <Badge className="ml-auto border-transparent bg-primary text-primary-foreground text-[10px]">
                        em rota
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {stops.length} parada(s) · espécie {brl(cash)} · taxa {brl(fee)}
                  </p>
                </header>

                <div className="flex-1 space-y-1.5 p-3">
                  {stops.map((o, idx) => (
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
                      {!dispatched && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => unassign.mutate(o.id)}
                        >
                          <Undo2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {stops.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      Atribua pedidos da fila.
                    </p>
                  )}
                </div>

                <div className="border-t border-border p-3">
                  {!dispatched ? (
                    <Button
                      className="w-full"
                      size="sm"
                      disabled={stops.length === 0 || dispatch.isPending}
                      onClick={() => route && dispatch.mutate(route.id)}
                    >
                      <Send className="mr-1.5 size-3.5" /> Despachar rota
                    </Button>
                  ) : closing === route?.id ? (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">
                        Encerrar fecha o acerto do dia. Paradas não concluídas ficam como estão.
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
                          onClick={() => close.mutate(route.id)}
                        >
                          Confirmar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full"
                      size="sm"
                      disabled={!!route?.closed_at}
                      onClick={() => route && setClosing(route.id)}
                    >
                      <Flag className="mr-1.5 size-3.5" />
                      {route?.closed_at ? "Rota encerrada" : "Encerrar rota"}
                    </Button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
