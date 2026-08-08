import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { TrendingUp, Sprout, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/marketing")({
  head: () => ({
    meta: [
      { title: "Marketing — Vieira Perfumes" },
      {
        name: "description",
        content: "Gasto das campanhas cruzado com as vendas de cada oferta: CPV, ROAS e LTV.",
      },
    ],
  }),
  component: MarketingPage,
});

type Row = {
  offer_id: string;
  offer_name: string;
  spend: number;
  conversations: number;
  clicks: number;
  sales_count: number;
  revenue: number;
  customers: number;
};

type Ltv = {
  offer_id: string | null;
  offer_name: string;
  customers: number;
  total_revenue: number;
  avg_ltv: number;
  avg_orders: number;
};

const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("sv-SE");
};
const today = () => new Date().toLocaleDateString("sv-SE");

// divisão que não explode quando o denominador é zero
const per = (a: number, b: number) => (b > 0 ? a / b : null);
const show = (v: number | null, fmt: (n: number) => string) => (v === null ? "—" : fmt(v));
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const mult = (v: number) => `${v.toFixed(2)}×`;

type MetaStatus = { configured: boolean };

function MarketingPage() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);

  const { data: metaStatus } = useQuery({
    queryKey: ["meta-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("meta_settings_status");
      if (error) throw error;
      return data as MetaStatus;
    },
  });

  // mesma sincronização de /configuracoes — aqui é onde o desempenho das
  // ofertas é olhado no dia a dia, então o botão vem junto
  const sync = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("meta-ads-sync", {
        body: { days: 30 },
      });
      if (error) {
        let detail = error.message;
        const res = (error as { context?: Response }).context;
        if (res?.json) {
          try {
            const body = await res.json();
            if (body?.error) detail = body.error;
          } catch {
            // corpo não era JSON
          }
        }
        throw new Error(detail);
      }
      return data as { campaigns: number; days: number };
    },
    onSuccess: (r) => {
      toast.success(`${r.campaigns} campanha(s) sincronizada(s)`);
      qc.invalidateQueries({ queryKey: ["ad-campaigns"] });
      qc.invalidateQueries({ queryKey: ["marketing"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["marketing", "offers", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("offer_performance", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const { data: organic } = useQuery({
    queryKey: ["marketing", "organic", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("organic_performance", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? [])[0] as { sales_count: number; revenue: number; customers: number };
    },
  });

  const { data: ltv = [] } = useQuery({
    queryKey: ["marketing", "ltv"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ltv_by_acquisition");
      if (error) throw error;
      return (data ?? []) as Ltv[];
    },
  });

  const spend = rows.reduce((s, r) => s + Number(r.spend), 0);
  const revenue = rows.reduce((s, r) => s + Number(r.revenue), 0);
  const sales = rows.reduce((s, r) => s + Number(r.sales_count), 0);
  const organicRevenue = Number(organic?.revenue ?? 0);

  return (
    <AppShell title="Marketing" subtitle="Campanhas cruzadas com as vendas de cada oferta">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">De</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button
          variant="outline"
          disabled={!metaStatus?.configured || sync.isPending}
          onClick={() => sync.mutate()}
        >
          <RefreshCw className={`mr-2 size-4 ${sync.isPending ? "animate-spin" : ""}`} />
          Sincronizar 30 dias
        </Button>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Investido" value={brl(spend)} />
        <Tile label="Faturamento de campanha" value={brl(revenue)} />
        <Tile
          label="ROAS geral"
          value={show(per(revenue, spend), mult)}
          hint={spend === 0 ? "sem gasto no período" : "retorno sobre o anúncio"}
        />
        <Tile
          label="Custo por venda"
          value={show(per(spend, sales), brl)}
          hint={`${sales} venda(s) de oferta`}
        />
      </div>

      <div className="panel mb-4 overflow-x-auto">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <TrendingUp className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Por oferta</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Oferta</TableHead>
              <TableHead className="text-right">Gasto</TableHead>
              <TableHead className="text-right">Conversas</TableHead>
              <TableHead className="text-right">Vendas</TableHead>
              <TableHead className="text-right">Conversão</TableHead>
              <TableHead className="text-right">CPV</TableHead>
              <TableHead className="text-right">Faturamento</TableHead>
              <TableHead className="text-right">ROAS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.offer_id}>
                <TableCell className="font-medium">{r.offer_name}</TableCell>
                <TableCell className="text-right">{brl(Number(r.spend))}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {r.conversations || "—"}
                </TableCell>
                <TableCell className="text-right">{r.sales_count}</TableCell>
                <TableCell className="text-right">
                  {show(per(Number(r.sales_count), Number(r.conversations)), pct)}
                </TableCell>
                <TableCell className="text-right">
                  {show(per(Number(r.spend), Number(r.sales_count)), brl)}
                </TableCell>
                <TableCell className="text-right font-medium">{brl(Number(r.revenue))}</TableCell>
                <TableCell className="text-right font-medium">
                  {show(per(Number(r.revenue), Number(r.spend)), mult)}
                </TableCell>
              </TableRow>
            ))}
            {organic && (
              <TableRow className="bg-muted/40">
                <TableCell className="font-medium">
                  <span className="flex items-center gap-1.5">
                    <Sprout className="size-3.5 text-muted-foreground" /> Orgânico
                  </span>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-right">{organic.sales_count}</TableCell>
                <TableCell className="text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-right font-medium">{brl(organicRevenue)}</TableCell>
                <TableCell className="text-right text-muted-foreground">—</TableCell>
              </TableRow>
            )}
            {rows.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Nenhuma oferta ativa.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="panel overflow-x-auto">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Valor do cliente por porta de entrada</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cada cliente conta na oferta da primeira compra dele. A receita soma tudo que ele já
            gastou depois, inclusive recompra e avulso.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entrou por</TableHead>
              <TableHead className="text-right">Clientes</TableHead>
              <TableHead className="text-right">Pedidos por cliente</TableHead>
              <TableHead className="text-right">LTV médio</TableHead>
              <TableHead className="text-right">Receita total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ltv.map((l) => (
              <TableRow key={l.offer_id ?? "organico"}>
                <TableCell className="font-medium">{l.offer_name}</TableCell>
                <TableCell className="text-right">{l.customers}</TableCell>
                <TableCell className="text-right">{Number(l.avg_orders).toFixed(1)}</TableCell>
                <TableCell className="text-right font-medium">{brl(Number(l.avg_ltv))}</TableCell>
                <TableCell className="text-right">{brl(Number(l.total_revenue))}</TableCell>
              </TableRow>
            ))}
            {ltv.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Ainda não há vendas entregues para calcular.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
