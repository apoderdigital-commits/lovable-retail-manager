import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { TrackingMap } from "@/components/tracking-map";
import type { TrackedCourier } from "@/components/tracking-map-impl";

export const Route = createFileRoute("/rastreio")({
  head: () => ({
    meta: [
      { title: "Rastreio das entregas — Vieira Perfumes" },
      {
        name: "description",
        content: "Posição ao vivo de cada motoboy, com aviso de quando o sinal parou de atualizar.",
      },
    ],
  }),
  component: TrackingPage,
});

// paleta fixa: cada motoboy pega uma cor pela posição na lista, sempre a
// mesma enquanto a lista de entregadores não mudar
const PALETTE = ["#2563eb", "#ea580c", "#16a34a", "#db2777", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626"];

const FRESH_MS = 90_000; // até 1min30 sem atualizar: sinal bom
const STALE_MS = 5 * 60_000; // até 5min: atenção; depois disso, sem sinal

function timeAgo(iso: string | null) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 15_000) return "agora";
  if (ms < 60_000) return `há ${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `há ${Math.floor(ms / 60_000)}min`;
  return `há ${Math.floor(ms / 3_600_000)}h`;
}

function TrackingPage() {
  const [focusId, setFocusId] = useState<string | null>(null);

  // reforça a renderização periodicamente só pra "há Xs" não ficar parado
  // na tela mesmo sem chegar posição nova
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

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

  const { data: locations = [] } = useQuery({
    queryKey: ["courier-locations"],
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("courier_locations").select("*");
      if (error) throw error;
      return data;
    },
  });

  const tracked: TrackedCourier[] = couriers.map((c, idx) => {
    const loc = locations.find((l) => l.courier_id === c.id);
    return {
      id: c.id,
      name: c.full_name || c.email,
      color: PALETTE[idx % PALETTE.length],
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      updatedAt: loc?.updated_at ?? null,
    };
  });

  const statusOf = (updatedAt: string | null) => {
    if (!updatedAt) return { label: "sem rastreio ainda", tone: "muted" as const };
    const ms = Date.now() - new Date(updatedAt).getTime();
    if (ms < FRESH_MS) return { label: `atualizado ${timeAgo(updatedAt)}`, tone: "ok" as const };
    if (ms < STALE_MS) return { label: `sem atualizar ${timeAgo(updatedAt)}`, tone: "warn" as const };
    return { label: `sem sinal ${timeAgo(updatedAt)}`, tone: "off" as const };
  };

  return (
    <AppShell title="Rastreio das entregas" subtitle="Posição ao vivo de cada motoboy">
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section className="panel h-fit">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Motoboys</h2>
          </header>
          <div className="space-y-1 p-2">
            {tracked.map((c) => {
              const status = statusOf(c.updatedAt);
              return (
                <button
                  key={c.id}
                  onClick={() => c.lat !== null && setFocusId(c.id)}
                  disabled={c.lat === null}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p
                      className={`text-xs ${
                        status.tone === "ok"
                          ? "text-success"
                          : status.tone === "warn"
                            ? "text-warning"
                            : "text-muted-foreground"
                      }`}
                    >
                      {status.label}
                    </p>
                  </div>
                </button>
              );
            })}
            {tracked.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Nenhum entregador cadastrado.
              </p>
            )}
          </div>
        </section>

        <section className="panel overflow-hidden" style={{ height: "70vh" }}>
          {tracked.some((c) => c.lat !== null) ? (
            <TrackingMap couriers={tracked} focusId={focusId} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <Radio className="size-6" />
              <p>Nenhum motoboy transmitindo posição no momento.</p>
              <p className="max-w-xs text-xs">
                O rastreio começa sozinho quando o entregador tem uma saída despachada e mantém a
                aba "Minha rota" aberta no celular.
              </p>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
