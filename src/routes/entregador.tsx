import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Camera,
  CalendarClock,
  XCircle,
  Flag,
  MapPin,
  Check,
  ChevronUp,
  ChevronDown,
  ListOrdered,
  Map as MapIcon,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CourierMap } from "@/components/courier-map";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/entregador")({
  head: () => ({
    meta: [
      { title: "Minha rota — Vieira Perfumes" },
      {
        name: "description",
        content: "Paradas do dia, confirmação de entrega com comprovante e encerramento de rota.",
      },
    ],
  }),
  component: CourierPage,
});

const PAYMENTS = ["dinheiro", "pix", "débito", "crédito", "boleto"];

const REASONS = [
  "Cliente ausente",
  "Endereço não localizado",
  "Cliente recusou",
  "Cliente sem o pagamento",
];

type RouteSummary = {
  route_id: string;
  courier_id: string;
  stops: number;
  delivered: number;
  not_delivered: number;
  pending: number;
  fee_payable: number;
  cash_collected: number;
};

const todayISO = () => new Date().toLocaleDateString("sv-SE");

// rua, bairro e cidade numa linha só — é o que a busca do mapa procura.
// a cidade vem do ViaCEP como "Recife - PE"; o " - PE" atrapalha a busca
const fullAddress = (s: {
  delivery_address: string | null;
  neighborhood: string | null;
  city?: string | null;
}) =>
  [s.delivery_address, s.neighborhood, s.city?.replace(/\s*-\s*[A-Za-z]{2}$/, "")]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");

function CourierPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();

  const [viewing, setViewing] = useState<string | null>(null);
  const [tab, setTab] = useState<"list" | "map">("list");

  // admin acompanha a rota de qualquer entregador; entregador vê só a dele
  const courierId = isAdmin && viewing ? viewing : (user?.id ?? "");

  const { data: couriers = [] } = useQuery({
    queryKey: ["couriers"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "courier");
      const ids = (roles ?? []).map((r) => r.user_id);
      if (ids.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      return data ?? [];
    },
  });

  const { data: stops = [], isLoading } = useQuery({
    queryKey: ["my-route", courierId],
    enabled: !!courierId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, customers(name, phone)")
        .eq("courier_id", courierId)
        .eq("status", "on_route")
        // ordem escolhida pelo entregador; o que ele ainda não mexeu vai pro
        // fim, do pedido mais antigo pro mais novo
        .order("stop_order", { ascending: true, nullsFirst: false })
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const reorder = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc("reorder_my_stops" as never, { p_sales: ids } as never);
      if (error) throw error;
    },
    // a lista troca na hora; se o banco recusar, volta como estava
    onMutate: async (ids) => {
      const key = ["my-route", courierId];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<typeof stops>(key);
      if (prev) {
        qc.setQueryData(
          key,
          ids.map((id) => prev.find((s) => s.id === id)!).filter(Boolean),
        );
      }
      return { prev, key };
    },
    onError: (e: Error, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["my-route", courierId] }),
  });

  const move = (idx: number, delta: -1 | 1) => {
    const ids = stops.map((s) => s.id);
    const to = idx + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[idx], ids[to]] = [ids[to], ids[idx]];
    reorder.mutate(ids);
  };

  // o banco já limita: entregador só recebe as próprias rotas, mesmo
  // que a chamada venha por fora da tela
  const { data: summary = [] } = useQuery({
    queryKey: ["my-summary", courierId],
    enabled: !!courierId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("route_day_summary", {
        p_date: new Date().toLocaleDateString("sv-SE"),
      });
      if (error) throw error;
      return ((data ?? []) as RouteSummary[]).filter((r) => r.courier_id === courierId);
    },
  });

  const dia = summary.reduce(
    (acc, r) => ({
      corridas: acc.corridas + Number(r.delivered),
      falhas: acc.falhas + Number(r.not_delivered),
      taxa: acc.taxa + Number(r.fee_payable),
      especie: acc.especie + Number(r.cash_collected),
    }),
    { corridas: 0, falhas: 0, taxa: 0, especie: 0 },
  );

  // quebra do que já foi entregue hoje por forma de pagamento — é o número
  // que o entregador confere na hora de acertar com a loja
  const { data: payments = [] } = useQuery({
    queryKey: ["my-payments", courierId],
    enabled: !!courierId,
    queryFn: async () => {
      const today = todayISO();
      const { data, error } = await supabase.rpc("route_payment_breakdown", {
        p_from: today,
        p_to: today,
      });
      if (error) throw error;
      return (
        (data ?? []) as {
          courier_id: string;
          payment_method: string;
          transactions: number;
          amount: number;
        }[]
      ).filter((p) => p.courier_id === courierId);
    },
  });

  const apurado = payments.reduce((s, p) => s + Number(p.amount), 0);

  // o entregador pode ter mais de uma saída aberta no mesmo dia
  const { data: openRoutes = [] } = useQuery({
    queryKey: ["my-route-header", courierId],
    enabled: !!courierId,
    queryFn: async () => {
      const { data } = await supabase
        .from("routes")
        .select("*")
        .eq("courier_id", courierId)
        .not("dispatched_at", "is", null)
        .is("closed_at", null)
        .order("dispatched_at");
      return data ?? [];
    },
  });

  // manda a posição pro rastreio (/rastreio) enquanto o próprio entregador
  // tem uma saída despachada em aberto. some sozinho quando encerra a
  // rota ou fecha a aba — a tela de rastreio percebe pelo silêncio.
  useEffect(() => {
    const tracking = user && courierId === user.id && openRoutes.length > 0;
    if (!tracking || !("geolocation" in navigator)) return;

    let lastSent = 0;
    const MIN_INTERVAL_MS = 15_000;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSent < MIN_INTERVAL_MS) return;
        lastSent = now;
        supabase
          .from("courier_locations")
          .upsert({
            courier_id: user!.id,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            updated_at: new Date().toISOString(),
          })
          .then(({ error }) => {
            if (error) console.error("courier_locations upsert", error);
          });
      },
      () => {
        // permissão negada ou GPS indisponível: não trava a tela do
        // entregador, só deixa de aparecer no rastreio
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [user, courierId, openRoutes.length]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-route"] });
    // sem isto o painel do topo não mexe ao confirmar entrega, que é
    // exatamente quando o entregador olha para ele
    qc.invalidateQueries({ queryKey: ["my-summary"] });
    qc.invalidateQueries({ queryKey: ["my-payments"] });
    qc.invalidateQueries({ queryKey: ["route-summary"] });
    qc.invalidateQueries({ queryKey: ["dispatch"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const close = useMutation({
    mutationFn: async (routeId: string) => {
      const { data, error } = await supabase.rpc("close_route", { p_route: routeId });
      if (error) throw error;
      return data as Record<string, number>;
    },
    onSuccess: (r) => {
      toast.success(
        `Rota encerrada. ${r["delivered"]} entregue(s) · taxa ${brl(Number(r["fee_payable"]))} · ` +
          `dinheiro a acertar ${brl(Number(r["cash_in_hand"]))}`,
        { duration: 12000 },
      );
      qc.invalidateQueries({ queryKey: ["my-route-header"] });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const done = stops.length === 0;

  return (
    <AppShell
      title="Minha rota"
      subtitle={
        isLoading ? "Carregando..." : done ? "Nenhuma parada pendente" : `${stops.length} parada(s)`
      }
    >
      <div className="mx-auto max-w-md space-y-3">
        {isAdmin && couriers.length > 0 && (
          <Select value={viewing ?? ""} onValueChange={setViewing}>
            <SelectTrigger>
              <SelectValue placeholder="Ver a rota de um entregador" />
            </SelectTrigger>
            <SelectContent>
              {couriers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.full_name || c.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="panel p-3">
            <p className="text-xs text-muted-foreground">Corridas hoje</p>
            <p className="mt-1 font-display text-2xl font-semibold">{dia.corridas}</p>
            {dia.falhas > 0 && (
              <p className="text-xs text-muted-foreground">{dia.falhas} não entregue(s)</p>
            )}
          </div>
          <div className="panel p-3">
            <p className="text-xs text-muted-foreground">Taxa a receber</p>
            <p className="mt-1 font-display text-2xl font-semibold text-success">
              {brl(dia.taxa)}
            </p>
            <p className="text-xs text-muted-foreground">só entregas concluídas</p>
          </div>
          <div className="panel col-span-2 flex items-baseline justify-between p-3">
            <div>
              <p className="text-xs text-muted-foreground">Dinheiro para acertar</p>
              <p className="text-xs text-muted-foreground">recebido em espécie</p>
            </div>
            <p className="font-display text-xl font-semibold">{brl(dia.especie)}</p>
          </div>
        </div>

        {payments.length > 0 && (
          <div className="panel p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Transações do dia por forma de pagamento
            </p>
            <div className="space-y-1.5">
              {payments.map((p) => (
                <div key={p.payment_method} className="flex items-center justify-between text-sm">
                  <span className="capitalize text-muted-foreground">
                    {p.payment_method} · {p.transactions} transação(ões)
                  </span>
                  <span className="font-medium">{brl(Number(p.amount))}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
              <span>Total apurado</span>
              <span>{brl(apurado)}</span>
            </div>
          </div>
        )}

        {done && !isLoading && (
          <div className="panel p-8 text-center">
            <Check className="mx-auto mb-2 size-8 text-success" />
            <p className="text-sm font-medium">Tudo entregue por aqui</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Quando a loja despachar novos pedidos, eles aparecem nesta tela.
            </p>
          </div>
        )}

        {!done && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "list" | "map")}>
            <TabsList className="w-full">
              <TabsTrigger value="list" className="flex-1">
                <ListOrdered className="mr-1.5 size-4" /> Paradas
              </TabsTrigger>
              <TabsTrigger value="map" className="flex-1">
                <MapIcon className="mr-1.5 size-4" /> Mapa
              </TabsTrigger>
            </TabsList>

            <TabsContent value="list" className="mt-3 space-y-3">
              {stops.length > 1 && (
                <p className="text-center text-xs text-muted-foreground">
                  Use as setas para colocar as paradas na ordem do seu trajeto.
                </p>
              )}

              {stops.map((s, idx) => (
                <StopCard
                  key={s.id}
                  stop={s}
                  index={idx + 1}
                  onDone={refresh}
                  onUp={idx > 0 ? () => move(idx, -1) : undefined}
                  onDown={idx < stops.length - 1 ? () => move(idx, 1) : undefined}
                />
              ))}
            </TabsContent>

            {/* só monta o mapa quando a aba abre: evita GPS e consultas de
                endereço enquanto o entregador está só na lista */}
            <TabsContent value="map" className="mt-3">
              {tab === "map" && (
                <CourierMap
                  stops={stops.map((s, idx) => ({
                    id: s.id,
                    index: idx + 1,
                    label: s.customers?.name ?? "Consumidor final",
                    address: fullAddress(s),
                  }))}
                  onOpenStops={() => setTab("list")}
                />
              )}
            </TabsContent>
          </Tabs>
        )}

        {openRoutes.map((r) => (
          <Button
            key={r.id}
            variant="outline"
            className="w-full"
            size="lg"
            disabled={close.isPending}
            onClick={() => close.mutate(r.id)}
          >
            <Flag className="mr-2 size-4" />
            Encerrar saída
            {openRoutes.length > 1 && r.dispatched_at
              ? ` das ${new Date(r.dispatched_at).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </Button>
        ))}
      </div>
    </AppShell>
  );
}

type Stop = {
  id: string;
  sale_number: number;
  total: number;
  payment_method: string;
  payment_method_2: string | null;
  payment_amount_2: number;
  delivery_address: string | null;
  neighborhood: string | null;
  city: string | null;
  notes: string | null;
  customers: { name: string; phone: string | null } | null;
};

function StopCard({
  stop,
  index,
  onDone,
  onUp,
  onDown,
}: {
  stop: Stop;
  index: number;
  onDone: () => void;
  onUp?: (() => void) | undefined;
  onDown?: (() => void) | undefined;
}) {
  const { user } = useAuth();
  const [action, setAction] = useState<null | "deliver" | "schedule" | "fail">(null);
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState(REASONS[0]);

  // pagamento na hora da entrega: o cliente pode trocar a forma ou dividir
  // em duas (ex.: parte no pix, parte em dinheiro)
  const total = Number(stop.total);
  const [pay1, setPay1] = useState(stop.payment_method);
  const [split, setSplit] = useState(!!stop.payment_method_2);
  const [pay2, setPay2] = useState(stop.payment_method_2 ?? "pix");
  const [amount2, setAmount2] = useState(
    stop.payment_method_2 ? String(stop.payment_amount_2) : "",
  );
  const value2 = Number(amount2.replace(",", ".") || 0);
  const splitInvalid = split && (pay2 === pay1 || value2 <= 0 || value2 >= total);
  const paymentChanged =
    pay1 !== stop.payment_method ||
    (split ? pay2 : null) !== (stop.payment_method_2 ?? null) ||
    (split ? value2 : 0) !== Number(stop.payment_amount_2 ?? 0);

  const run = useMutation({
    mutationFn: async () => {
      if (action === "deliver") {
        if (!file) throw new Error("Envie a foto do comprovante");
        if (!user) throw new Error("Sessão expirada");
        if (splitInvalid) throw new Error("Confira as duas formas de pagamento");
        if (paymentChanged) {
          const { error: payErr } = await supabase.rpc("set_delivery_payment" as never, {
            p_sale: stop.id,
            p_method: pay1,
            p_method_2: split ? pay2 : null,
            p_amount_2: split ? value2 : 0,
          } as never);
          if (payErr) throw payErr;
        }
        const ext = file.name.split(".").pop() || "jpg";
        // a pasta precisa ser o id de quem envia: é o que a política do bucket exige
        const path = `${user.id}/${stop.id}-${Date.now()}.${ext}`;
        const { error: up } = await supabase.storage
          .from("delivery-proofs")
          .upload(path, file, { contentType: file.type });
        if (up) throw up;
        const { error } = await supabase.rpc("transition_sale", {
          p_sale: stop.id,
          p_to: "delivered",
          p_proof: path,
        });
        if (error) throw error;
        return;
      }
      if (action === "schedule") {
        const { error } = await supabase.rpc("transition_sale", {
          p_sale: stop.id,
          p_to: "scheduled",
          p_schedule: date,
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.rpc("transition_sale", {
        p_sale: stop.id,
        p_to: "not_delivered",
        ...(reason ? { p_reason: reason } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        action === "deliver"
          ? "Entrega confirmada"
          : action === "schedule"
            ? "Reagendado"
            : "Marcado como não entregue",
      );
      setAction(null);
      setFile(null);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <article className="panel p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {index}. {stop.customers?.name ?? "Consumidor final"}
          </p>
          <p className="mt-0.5 flex items-start gap-1 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {stop.delivery_address ?? "sem endereço"}
              {stop.neighborhood ? ` · ${stop.neighborhood}` : ""}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="secondary">#{stop.sale_number}</Badge>
          {(onUp || onDown) && (
            <div className="flex flex-col">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={!onUp}
                onClick={onUp}
                aria-label="Subir parada"
              >
                <ChevronUp className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={!onDown}
                onClick={onDown}
                aria-label="Descer parada"
              >
                <ChevronDown className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {stop.notes && (
        <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">Obs.: {stop.notes}</p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="font-display text-lg font-semibold">{brl(Number(stop.total))}</span>
        <span className="text-sm text-muted-foreground">
          {stop.payment_method}
          {stop.payment_method_2 ? ` + ${stop.payment_method_2}` : ""}
        </span>
      </div>

      {stop.customers?.phone && (
        <a
          href={`tel:${stop.customers.phone}`}
          className="mt-1 block text-sm text-accent underline-offset-2 hover:underline"
        >
          {stop.customers.phone}
        </a>
      )}

      <Button className="mt-3 w-full" size="lg" onClick={() => setAction("deliver")}>
        <Camera className="mr-2 size-4" /> Confirmar entrega
      </Button>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={() => setAction("schedule")}>
          <CalendarClock className="mr-1.5 size-3.5" /> Reagendar
        </Button>
        <Button variant="outline" size="sm" onClick={() => setAction("fail")}>
          <XCircle className="mr-1.5 size-3.5" /> Não entregue
        </Button>
      </div>

      <Dialog open={!!action} onOpenChange={(v) => !v && setAction(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {action === "deliver"
                ? "Confirmar entrega"
                : action === "schedule"
                  ? "Reagendar entrega"
                  : "Não entregue"}
            </DialogTitle>
          </DialogHeader>

          {action === "deliver" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Forma de pagamento</Label>
                <Select value={pay1} onValueChange={setPay1}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENTS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={split}
                    onChange={(e) => setSplit(e.target.checked)}
                  />
                  Cliente pagou em 2 formas
                </label>

                {split && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={pay2} onValueChange={setPay2}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENTS.filter((p) => p !== pay1).map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        placeholder="Valor"
                        value={amount2}
                        onChange={(e) => setAmount2(e.target.value)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {pay1}: <strong>{brl(Math.max(0, total - value2))}</strong> · {pay2}:{" "}
                      <strong>{brl(value2)}</strong> · total {brl(total)}
                    </p>
                    {splitInvalid && (
                      <p className="text-xs text-destructive">
                        {pay2 === pay1
                          ? "Escolha duas formas diferentes."
                          : `O valor precisa ser maior que zero e menor que ${brl(total)}.`}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Foto do comprovante</Label>
                {/* sem "capture": o celular oferece tirar foto agora ou
                    escolher uma da galeria */}
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <p className="text-xs text-muted-foreground">
                  Tire a foto na hora ou escolha da galeria. Sem a foto a entrega não é concluída.
                  Vale o comprovante de pagamento ou a nota assinada.
                </p>
              </div>
            </div>
          )}

          {action === "schedule" && (
            <div className="space-y-2">
              <Label>Nova data</Label>
              <Input
                type="date"
                min={todayISO()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                O produto continua reservado para este pedido até a nova data.
              </p>
            </div>
          )}

          {action === "fail" && (
            <div className="space-y-2">
              <Label>Motivo</Label>
              <Select value={reason ?? ""} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Esta parada não gera taxa de entrega. O pedido volta para a loja redistribuir.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Voltar
            </Button>
            <Button
              disabled={
                run.isPending ||
                (action === "deliver" && (!file || splitInvalid)) ||
                (action === "schedule" && !date)
              }
              onClick={() => run.mutate()}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
