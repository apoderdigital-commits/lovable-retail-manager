import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Wallet, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
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

export const Route = createFileRoute("/financeiro")({
  head: () => ({
    meta: [
      { title: "Financeiro — Vieira Perfumes" },
      {
        name: "description",
        content: "Faturamento menos custo de produto, motoboy, tráfego e folha, com a margem.",
      },
    ],
  }),
  component: FinancePage,
});

type Summary = {
  dias: number;
  pedidos: number;
  receita: number;
  custo_produto: number;
  custo_motoboy: number;
  custo_trafego: number;
  custo_fixo: number;
};

type ByOffer = {
  offer_id: string | null;
  offer_name: string;
  orders: number;
  revenue: number;
  product_cost: number;
  courier_cost: number;
  ad_cost: number;
};

const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("sv-SE");
};
const today = () => new Date().toLocaleDateString("sv-SE");

function FinancePage() {
  const { isAdmin } = useAuth();
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);

  const { data: s } = useQuery({
    queryKey: ["finance", "summary", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("financial_summary", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return data as Summary;
    },
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["finance", "by-offer", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("financial_by_offer", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as ByOffer[];
    },
  });

  const receita = Number(s?.receita ?? 0);
  const custos =
    Number(s?.custo_produto ?? 0) +
    Number(s?.custo_motoboy ?? 0) +
    Number(s?.custo_trafego ?? 0) +
    Number(s?.custo_fixo ?? 0);
  const lucro = receita - custos;
  const margem = receita > 0 ? (lucro / receita) * 100 : null;

  return (
    <AppShell
      title="Financeiro"
      subtitle={s ? `${s.pedidos} pedido(s) entregue(s) no período` : "Carregando..."}
      actions={
        isAdmin ? (
          <Button variant="outline" size="sm" asChild>
            <Link to="/custos">
              <SlidersHorizontal className="mr-1.5 size-3.5" /> Configurar custos
            </Link>
          </Button>
        ) : null
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">De</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="panel mb-4">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Wallet className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Resultado do período</h2>
        </div>
        <div className="divide-y divide-border">
          <Line label="Faturamento" value={receita} strong />
          <Line label="Custo dos produtos" value={-Number(s?.custo_produto ?? 0)} />
          <Line label="Motoboy" value={-Number(s?.custo_motoboy ?? 0)} hint="taxas devidas" />
          <Line label="Tráfego" value={-Number(s?.custo_trafego ?? 0)} hint="gasto nas campanhas" />
          <Line
            label="Custos fixos"
            value={-Number(s?.custo_fixo ?? 0)}
            hint={`rateado por ${s?.dias ?? 0} dia(s)`}
          />
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-display text-base font-semibold">Lucro</p>
              {margem !== null && (
                <p className="text-xs text-muted-foreground">
                  margem de {margem.toFixed(1)}%
                </p>
              )}
            </div>
            <p
              className={`font-display text-2xl font-semibold ${
                lucro < 0 ? "text-destructive" : "text-success"
              }`}
            >
              {brl(lucro)}
            </p>
          </div>
        </div>
      </div>

      <div className="panel mb-4 overflow-x-auto">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Por oferta</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Sem os custos fixos, que são da loja inteira e não de uma oferta.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Oferta</TableHead>
              <TableHead className="text-right">Pedidos</TableHead>
              <TableHead className="text-right">Faturamento</TableHead>
              <TableHead className="text-right">Produto</TableHead>
              <TableHead className="text-right">Motoboy</TableHead>
              <TableHead className="text-right">Tráfego</TableHead>
              <TableHead className="text-right">Resultado</TableHead>
              <TableHead className="text-right">Margem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const rev = Number(r.revenue);
              const res =
                rev - Number(r.product_cost) - Number(r.courier_cost) - Number(r.ad_cost);
              const mg = rev > 0 ? (res / rev) * 100 : null;
              return (
                <TableRow key={r.offer_id ?? "avulso"}>
                  <TableCell className="font-medium">{r.offer_name}</TableCell>
                  <TableCell className="text-right">{r.orders}</TableCell>
                  <TableCell className="text-right">{brl(rev)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {brl(Number(r.product_cost))}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {brl(Number(r.courier_cost))}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {brl(Number(r.ad_cost))}
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${res < 0 ? "text-destructive" : ""}`}
                  >
                    {brl(res)}
                  </TableCell>
                  <TableCell className="text-right">
                    {mg === null ? "—" : `${mg.toFixed(1)}%`}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Nenhuma venda entregue no período.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

    </AppShell>
  );
}

function Line({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: number;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div>
        <p className={`text-sm ${strong ? "font-medium" : ""}`}>{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <p className={`text-sm ${strong ? "font-medium" : "text-muted-foreground"}`}>
        {value < 0 ? `− ${brl(Math.abs(value))}` : brl(value)}
      </p>
    </div>
  );
}

