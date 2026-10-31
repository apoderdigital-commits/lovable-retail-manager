import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Wallet, SlidersHorizontal, Package, RefreshCw, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { useMetaSync } from "@/hooks/use-meta-sync";
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
import { brl, dateTime, monthStartISO, todayISO } from "@/lib/format";

export const Route = createFileRoute("/financeiro")({
  head: () => ({
    meta: [
      { title: "Financeiro — Vieira Perfumes" },
      {
        name: "description",
        content: "Faturamento menos custo de produto, motoboy e tráfego, com a margem.",
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
  custo_correios: number;
  custo_taxas: number;
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

type ByProduct = {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  revenue: number;
};

// dia de hoje e início do mês em Recife (não no fuso do aparelho)
const firstOfMonth = monthStartISO;
const today = () => todayISO();

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

  const { data: byProduct = [] } = useQuery({
    queryKey: ["finance", "by-product", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("product_cost_breakdown", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as ByProduct[];
    },
  });

  // tráfego vem do Meta: sincroniza sozinho ao abrir quando está velho
  const meta = useMetaSync({ enabled: isAdmin });
  const trafegoHint =
    meta.trackedCount === 0
      ? "nenhuma campanha acompanhada: marque em Configurações"
      : meta.lastSync
        ? `campanhas acompanhadas · sincronizado ${dateTime(meta.lastSync)}`
        : "campanhas acompanhadas · ainda não sincronizado";

  // produto vendido sem custo no cadastro entra como zero e esconde margem
  const semCusto = byProduct.filter((p) => Number(p.unit_cost) === 0);

  // lucro = faturamento menos produto, motoboy e tráfego. Custo fixo rateado
  // saiu da tela a pedido do usuário (31/10/2026) e não entra na conta.
  const receita = Number(s?.receita ?? 0);
  const custos =
    Number(s?.custo_produto ?? 0) +
    Number(s?.custo_motoboy ?? 0) +
    Number(s?.custo_correios ?? 0) +
    Number(s?.custo_taxas ?? 0) +
    Number(s?.custo_trafego ?? 0);
  const lucro = receita - custos;
  const margem = receita > 0 ? (lucro / receita) * 100 : null;

  return (
    <AppShell
      title="Financeiro"
      subtitle={s ? `${s.pedidos} pedido(s) no período, sem as canceladas` : "Carregando..."}
      actions={
        isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.sync.isPending}
              onClick={() => meta.sync.mutate({})}
            >
              <RefreshCw className={`mr-1.5 size-3.5${meta.sync.isPending ? " animate-spin" : ""}`} />
              {meta.sync.isPending ? "Sincronizando..." : "Sincronizar Meta"}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/custos">
                <SlidersHorizontal className="mr-1.5 size-3.5" /> Configurar custos
              </Link>
            </Button>
          </div>
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
          <Line
            label="Custo dos produtos"
            value={-Number(s?.custo_produto ?? 0)}
            hint="quantidade × custo de cada produto"
          />
          <Line label="Motoboy" value={-Number(s?.custo_motoboy ?? 0)} hint="taxas devidas" />
          <Line
            label="Correios"
            value={-Number(s?.custo_correios ?? 0)}
            hint="frete postado, cobrado do cliente"
          />
          <Line
            label="Impostos"
            value={-Number(s?.custo_taxas ?? 0)}
            hint="taxas da maquininha: pix por conta da loja, débito e crédito repassados"
          />
          <Line label="Tráfego" value={-Number(s?.custo_trafego ?? 0)} hint={trafegoHint} />
          <Line
            label="Custos totais"
            value={-custos}
            hint="produtos + motoboy + Correios + impostos + tráfego"
            strong
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
                  Nenhuma venda no período.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="panel overflow-x-auto">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Package className="size-4 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Custo de produto</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Quantidade vendida vezes o custo cadastrado em cada produto. A soma desta tabela é
              o "Custo dos produtos" lá em cima.
            </p>
          </div>
        </div>
        {semCusto.length > 0 && (
          <div className="flex items-start gap-2 border-b border-border bg-warning/10 px-4 py-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium">
                {semCusto.length} produto(s) vendido(s) sem custo no cadastro
              </p>
              <p className="text-xs text-muted-foreground">
                {semCusto.map((p) => p.product_name).join(", ")}. Entram como custo zero e inflam
                a margem.{" "}
                <Link to="/produtos" className="underline underline-offset-2">
                  Preencher o custo em Produtos
                </Link>
                .
              </p>
            </div>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Qtd. vendida</TableHead>
              <TableHead className="text-right">Custo unitário</TableHead>
              <TableHead className="text-right">Custo total</TableHead>
              <TableHead className="text-right">Faturamento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byProduct.map((p) => (
              <TableRow key={p.product_id}>
                <TableCell className="font-medium">{p.product_name}</TableCell>
                <TableCell className="text-right">{p.quantity}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {brl(Number(p.unit_cost))}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {brl(Number(p.total_cost))}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {brl(Number(p.revenue))}
                </TableCell>
              </TableRow>
            ))}
            {byProduct.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Nenhum produto vendido no período.
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

