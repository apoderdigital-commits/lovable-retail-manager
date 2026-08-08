import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Metric } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brl, dateTime } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("sv-SE");
};
const today = () => new Date().toLocaleDateString("sv-SE");

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios de vendas — Vieira Perfumes" },
      {
        name: "description",
        content: "Acompanhe faturamento, ticket médio, formas de pagamento e produtos campeões.",
      },
      { property: "og:title", content: "Relatórios de vendas — Vieira Perfumes" },
      {
        property: "og:description",
        content: "Acompanhe faturamento, ticket médio, formas de pagamento e produtos campeões.",
      },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);

  const { data } = useQuery({
    queryKey: ["reports", from, to],
    queryFn: async () => {
      const [salesRes, itemsRes] = await Promise.all([
        supabase
          .from("sales")
          .select("id, sale_number, total, discount, payment_method, created_at")
          .gte("created_at", `${from}T00:00:00`)
          .lte("created_at", `${to}T23:59:59`)
          .order("created_at", { ascending: false }),
        supabase
          .from("sale_items")
          .select("product_name, quantity, total, created_at")
          .gte("created_at", `${from}T00:00:00`)
          .lte("created_at", `${to}T23:59:59`),
      ]);
      if (salesRes.error) throw salesRes.error;
      if (itemsRes.error) throw itemsRes.error;
      return { sales: salesRes.data, items: itemsRes.data };
    },
  });

  const sales = data?.sales ?? [];
  const items = data?.items ?? [];

  const revenue = sales.reduce((s, v) => s + Number(v.total), 0);
  const ticket = sales.length ? revenue / sales.length : 0;
  const discounts = sales.reduce((s, v) => s + Number(v.discount), 0);

  const byPayment = Object.entries(
    sales.reduce<Record<string, number>>((acc, s) => {
      acc[s.payment_method] = (acc[s.payment_method] ?? 0) + Number(s.total);
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  const topProducts = Object.entries(
    items.reduce<Record<string, { qty: number; total: number }>>((acc, i) => {
      const cur = acc[i.product_name] ?? { qty: 0, total: 0 };
      acc[i.product_name] = { qty: cur.qty + i.quantity, total: cur.total + Number(i.total) };
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 8);

  return (
    <AppShell
      title="Relatórios"
      subtitle="Faturamento, ticket médio, formas de pagamento e produtos campeões"
      actions={
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">De</Label>
            <Input type="date" className="h-8" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Até</Label>
            <Input type="date" className="h-8" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Faturamento" value={brl(revenue)} />
        <Metric label="Vendas" value={String(sales.length)} />
        <Metric label="Ticket médio" value={brl(ticket)} />
        <Metric label="Descontos concedidos" value={brl(discounts)} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="font-display text-base font-semibold">Por forma de pagamento</h2>
          <ul className="mt-4 space-y-3">
            {byPayment.map(([method, value]) => (
              <li key={method}>
                <div className="flex justify-between text-sm">
                  <span className="capitalize">{method}</span>
                  <span className="font-medium">{brl(value)}</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-secondary">
                  <div
                    className="h-2 rounded-full bg-accent"
                    style={{ width: `${revenue ? (value / revenue) * 100 : 0}%` }}
                  />
                </div>
              </li>
            ))}
            {byPayment.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma venda no período.
              </p>
            )}
          </ul>
        </section>

        <section className="panel p-5">
          <h2 className="font-display text-base font-semibold">Produtos mais vendidos</h2>
          <ul className="mt-4 divide-y divide-border">
            {topProducts.map(([name, v]) => (
              <li key={name} className="flex items-center justify-between py-2.5 text-sm">
                <span className="truncate pr-3">{name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {v.qty} un · <span className="font-medium text-foreground">{brl(v.total)}</span>
                </span>
              </li>
            ))}
            {topProducts.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Sem dados ainda.</p>
            )}
          </ul>
        </section>
      </div>

      <section className="panel mt-5 overflow-hidden">
        <header className="border-b border-border px-4 py-3">
          <h2 className="font-display text-base font-semibold">Histórico de vendas</h2>
        </header>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Venda</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Pagamento</TableHead>
              <TableHead className="text-right">Desconto</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">#{s.sale_number}</TableCell>
                <TableCell className="text-muted-foreground">{dateTime(s.created_at)}</TableCell>
                <TableCell className="capitalize text-muted-foreground">
                  {s.payment_method}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {brl(Number(s.discount))}
                </TableCell>
                <TableCell className="text-right font-medium">{brl(Number(s.total))}</TableCell>
              </TableRow>
            ))}
            {sales.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Nenhuma venda registrada no período.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </AppShell>
  );
}
