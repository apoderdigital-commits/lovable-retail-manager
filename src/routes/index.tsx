import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Metric, StockBadge } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { brl, dateTime } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Painel da loja — Vieira Perfumes" },
      {
        name: "description",
        content: "Faturamento do dia, alertas de estoque e últimas vendas da sua loja.",
      },
      { property: "og:title", content: "Painel da loja — Vieira Perfumes" },
      {
        property: "og:description",
        content: "Faturamento do dia, alertas de estoque e últimas vendas da sua loja.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const [today, month, products, recent] = await Promise.all([
        supabase.from("sales").select("total").gte("created_at", startOfDay.toISOString()),
        supabase.from("sales").select("total").gte("created_at", startOfMonth.toISOString()),
        supabase.from("products").select("*").order("stock", { ascending: true }),
        supabase
          .from("sales")
          .select("id, sale_number, total, payment_method, created_at, customers(name)")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

      const todayRows = today.data ?? [];
      const monthRows = month.data ?? [];
      const allProducts = products.data ?? [];

      return {
        todayTotal: todayRows.reduce((s, r) => s + Number(r.total), 0),
        todayCount: todayRows.length,
        monthTotal: monthRows.reduce((s, r) => s + Number(r.total), 0),
        productCount: allProducts.length,
        lowStock: allProducts.filter((p) => p.stock <= p.min_stock),
        stockValue: allProducts.reduce((s, p) => s + Number(p.price) * p.stock, 0),
        recent: recent.data ?? [],
      };
    },
  });

  return (
    <AppShell
      title="Painel da loja"
      subtitle="Resumo em tempo real das operações"
      actions={
        <Button asChild>
          <Link to="/pdv">
            <ShoppingCart className="mr-2 size-4" /> Nova venda
          </Link>
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Vendas hoje"
          value={brl(data?.todayTotal ?? 0)}
          hint={`${data?.todayCount ?? 0} venda(s) registrada(s)`}
        />
        <Metric label="Faturamento do mês" value={brl(data?.monthTotal ?? 0)} tone="accent" />
        <Metric
          label="Produtos cadastrados"
          value={String(data?.productCount ?? 0)}
          hint={`Estoque avaliado em ${brl(data?.stockValue ?? 0)}`}
        />
        <Metric
          label="Alertas de estoque"
          value={String(data?.lowStock.length ?? 0)}
          hint="Itens no mínimo ou zerados"
          tone="warning"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <section className="panel lg:col-span-3">
          <header className="border-b border-border px-4 py-3">
            <h2 className="font-display text-base font-semibold">Últimas vendas</h2>
          </header>
          <div className="divide-y divide-border">
            {(data?.recent ?? []).map((sale) => (
              <div key={sale.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">
                    #{sale.sale_number} · {sale.customers?.name ?? "Consumidor final"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dateTime(sale.created_at)} · {sale.payment_method}
                  </p>
                </div>
                <span className="font-display font-semibold">{brl(Number(sale.total))}</span>
              </div>
            ))}
            {data && data.recent.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nenhuma venda registrada ainda.
              </p>
            )}
          </div>
        </section>

        <section className="panel lg:col-span-2">
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <TriangleAlert className="size-4 text-warning" />
            <h2 className="font-display text-base font-semibold">Reposição de estoque</h2>
          </header>
          <div className="divide-y divide-border">
            {(data?.lowStock ?? []).slice(0, 8).map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.stock} em estoque · mínimo {p.min_stock}
                  </p>
                </div>
                <StockBadge stock={p.stock} min={p.min_stock} />
              </div>
            ))}
            {data && data.lowStock.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Estoque saudável.
              </p>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
