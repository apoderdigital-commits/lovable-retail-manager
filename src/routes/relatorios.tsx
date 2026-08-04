import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Metric } from "@/components/AppShell";
import { brl, dateTime } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  const { data } = useQuery({
    queryKey: ["reports"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const [salesRes, itemsRes] = await Promise.all([
        supabase
          .from("sales")
          .select("id, sale_number, total, discount, payment_method, created_at")
          .gte("created_at", since.toISOString())
          .order("created_at", { ascending: false }),
        supabase
          .from("sale_items")
          .select("product_name, quantity, total, created_at")
          .gte("created_at", since.toISOString()),
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
    <AppShell title="Relatórios" subtitle="Últimos 30 dias">
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
