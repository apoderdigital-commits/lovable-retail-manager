import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Camera, CalendarClock, XCircle, Flag, MapPin, Check } from "lucide-react";
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

function CourierPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();

  const [viewing, setViewing] = useState<string | null>(null);

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
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

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

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-route"] });
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

        {done && !isLoading && (
          <div className="panel p-8 text-center">
            <Check className="mx-auto mb-2 size-8 text-success" />
            <p className="text-sm font-medium">Tudo entregue por aqui</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Quando a loja despachar novos pedidos, eles aparecem nesta tela.
            </p>
          </div>
        )}

        {stops.map((s, idx) => (
          <StopCard key={s.id} stop={s} index={idx + 1} onDone={refresh} />
        ))}

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
  delivery_address: string | null;
  neighborhood: string | null;
  customers: { name: string; phone: string | null } | null;
};

function StopCard({
  stop,
  index,
  onDone,
}: {
  stop: Stop;
  index: number;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const [action, setAction] = useState<null | "deliver" | "schedule" | "fail">(null);
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState(REASONS[0]);

  const run = useMutation({
    mutationFn: async () => {
      if (action === "deliver") {
        if (!file) throw new Error("Tire a foto do comprovante");
        if (!user) throw new Error("Sessão expirada");
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
        <Badge variant="secondary" className="shrink-0">
          #{stop.sale_number}
        </Badge>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="font-display text-lg font-semibold">{brl(Number(stop.total))}</span>
        <span className="text-sm text-muted-foreground">{stop.payment_method}</span>
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
            <div className="space-y-2">
              <Label>Foto do comprovante</Label>
              <Input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Sem a foto a entrega não é concluída. Vale o comprovante de pagamento ou a nota
                assinada.
              </p>
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
                (action === "deliver" && !file) ||
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
