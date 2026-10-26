// dashboard de entregas: metricas gerais e por motoboy, com filtro de periodo
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { Wallet, Landmark, CreditCard, Receipt, Printer, Smartphone, HandCoins } from "lucide-react";
import { DeliveryProofs } from "@/components/delivery-proofs";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Metric } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CourierStatementPrint, type CourierStatementData } from "@/components/receipt/CourierStatement";
import { usePrintSettings, printPageStyle } from "@/hooks/use-print-settings";
import { brl, todayISO } from "@/lib/format";

export const Route = createFileRoute("/entregas-dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard de entregas — Vieira Perfumes" },
      {
        name: "description",
        content: "Métricas de entrega por motoboy: apurado por forma de pagamento e taxa a pagar.",
      },
    ],
  }),
  component: DeliveriesDashboardPage,
});

type RangeSummary = {
  courier_id: string;
  stops: number;
  delivered: number;
  not_delivered: number;
  pending: number;
  fee_payable: number;
  cash_collected: number;
};

type PaymentBreakdown = {
  courier_id: string;
  payment_method: string;
  transactions: number;
  amount: number;
};



// dinheiro, pix e boleto entram como estão; débito e crédito viram "Cartão"
// porque pra quem confere a rua no fim do dia o que importa é se caiu na
// maquininha ou não — a bandeira específica não muda o acerto.
// pix se divide pelo destino: máquina caiu na loja, entregador caiu na
// chave dele e entra no acerto. "pix" puro é venda antiga, sem destino.
const CATEGORY: Record<string, string> = {
  "pix máquina": "Pix máquina",
  "pix entregador": "Pix entregador",
  pix: "Pix sem destino",
  dinheiro: "Espécie",
  "débito": "Cartão",
  "crédito": "Cartão",
};
const categoryOf = (method: string) => CATEGORY[method] ?? "Outros";

function DeliveriesDashboardPage() {
  const [from, setFrom] = useState(todayISO);
  const [to, setTo] = useState(todayISO);
  const [courierId, setCourierId] = useState<string>("all");

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

  const { data: range = [] } = useQuery({
    queryKey: ["route-range-summary", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("route_range_summary", { p_from: from, p_to: to });
      if (error) throw error;
      return (data ?? []) as RangeSummary[];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["route-payment-breakdown", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("route_payment_breakdown", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as PaymentBreakdown[];
    },
  });

  const nameOf = (id: string) => {
    const c = couriers.find((x) => x.id === id);
    return c?.full_name || c?.email || "—";
  };

  // um extrato por motoboy. "Todos juntos" imprime todos em sequência; com
  // um motoboy selecionado, imprime só o dele
  const allStatements: CourierStatementData[] = range.map((r) => {
    const meus = payments.filter((p) => p.courier_id === r.courier_id);
    return {
      courierId: r.courier_id,
      name: nameOf(r.courier_id),
      delivered: Number(r.delivered),
      notDelivered: Number(r.not_delivered),
      fee: Number(r.fee_payable),
      payments: meus.map((p) => ({
        method: p.payment_method,
        transactions: Number(p.transactions),
        amount: Number(p.amount),
      })),
      apurado: meus.reduce((s, p) => s + Number(p.amount), 0),
      toSettle: Number(r.cash_collected),
    };
  });
  const statements =
    courierId === "all" ? allStatements : allStatements.filter((s) => s.courierId === courierId);

  const { settings: printSettings } = usePrintSettings();
  const statementPaperWidth = printSettings.printerType === "thermal" ? printSettings.paperWidth : "auto";
  const statementRef = useRef<HTMLDivElement>(null);
  const printStatements = useReactToPrint({
    contentRef: statementRef,
    documentTitle: "Extratos motoboys",
    pageStyle: printPageStyle(printSettings),
  });

  // "todos" soma tudo; um motoboy específico filtra pro dele só. o resto
  // da tela usa o mesmo cálculo pros dois casos, sem branch separado.
  const visibleRange = courierId === "all" ? range : range.filter((r) => r.courier_id === courierId);
  const visiblePayments =
    courierId === "all" ? payments : payments.filter((p) => p.courier_id === courierId);

  const totals = visibleRange.reduce(
    (acc, r) => ({
      delivered: acc.delivered + Number(r.delivered),
      notDelivered: acc.notDelivered + Number(r.not_delivered),
      fee: acc.fee + Number(r.fee_payable),
      toSettle: acc.toSettle + Number(r.cash_collected),
    }),
    { delivered: 0, notDelivered: 0, fee: 0, toSettle: 0 },
  );

  const byCategory = visiblePayments.reduce<Record<string, { amount: number; transactions: number }>>(
    (acc, p) => {
      const cat = categoryOf(p.payment_method);
      const cur = acc[cat] ?? { amount: 0, transactions: 0 };
      acc[cat] = {
        amount: cur.amount + Number(p.amount),
        transactions: cur.transactions + Number(p.transactions),
      };
      return acc;
    },
    {},
  );
  const apurado = Object.values(byCategory).reduce((s, c) => s + c.amount, 0);
  const CATEGORIES = [
    "Pix máquina",
    "Pix entregador",
    "Espécie",
    "Cartão",
    ...(byCategory["Pix sem destino"] ? ["Pix sem destino"] : []),
    ...(byCategory["Outros"] ? ["Outros"] : []),
  ];
  const CATEGORY_ICON: Record<string, typeof Wallet> = {
    "Pix máquina": Landmark,
    "Pix entregador": Smartphone,
    "Pix sem destino": Landmark,
    Espécie: Wallet,
    Cartão: CreditCard,
    Outros: Receipt,
  };

  return (
    <AppShell
      title="Dashboard de entregas"
      subtitle="Apurado e taxa a pagar por motoboy, período selecionável"
      actions={
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Motoboy</Label>
            <Select value={courierId} onValueChange={setCourierId}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos juntos</SelectItem>
                {couriers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name || c.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">De</Label>
            <Input type="date" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Até</Label>
            <Input type="date" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button
            variant="outline"
            className="h-9"
            disabled={statements.length === 0}
            onClick={() => printStatements()}
          >
            <Printer className="mr-2 size-4" />
            {courierId === "all" ? "Imprimir extratos" : "Imprimir extrato"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Entregues" value={String(totals.delivered)} />
        <Metric
          label="Não entregues"
          value={String(totals.notDelivered)}
          tone={totals.notDelivered > 0 ? "warning" : "default"}
        />
        <Metric label="Taxa de entrega a pagar" value={brl(totals.fee)} tone="accent" />
        <Metric label="Total apurado" value={brl(apurado)} hint="todas as formas de pagamento" />
        <Metric
          label="A acertar"
          value={brl(totals.toSettle)}
          hint="espécie + pix entregador, na mão do motoboy"
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CATEGORIES.map((cat) => {
          const Icon = CATEGORY_ICON[cat] ?? Receipt;
          const v = byCategory[cat] ?? { amount: 0, transactions: 0 };
          return (
            <div key={cat} className="panel p-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Icon className="size-3.5" /> {cat}
              </div>
              <p className="mt-2 font-display text-2xl font-semibold">{brl(v.amount)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {v.transactions} transação{v.transactions === 1 ? "" : "ões"}
              </p>
            </div>
          );
        })}
      </div>

      <section className="panel mt-4">
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            {courierId === "all" ? "Extrato por motoboy" : `Extrato de ${nameOf(courierId)}`}
          </h2>
        </header>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {statements.map((s) => (
            <div key={s.courierId} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">{s.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {s.delivered} entregue(s) · {s.notDelivered} não entregue(s) · taxa {brl(s.fee)}
              </p>
              <div className="mt-2 space-y-1">
                {s.payments.map((p) => (
                  <div key={p.method} className="flex justify-between text-xs">
                    <span className="capitalize text-muted-foreground">
                      {p.method} · {p.transactions}x
                    </span>
                    <span className="font-medium">{brl(p.amount)}</span>
                  </div>
                ))}
                {s.payments.length === 0 && (
                  <p className="text-xs text-muted-foreground">Sem entregas no período.</p>
                )}
              </div>
              <div className="mt-2 flex justify-between border-t border-border pt-1.5 text-xs font-semibold">
                <span>Apurado</span>
                <span>{brl(s.apurado)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs font-semibold text-accent">
                <span className="inline-flex items-center gap-1">
                  <HandCoins className="size-3.5" /> A acertar
                </span>
                <span>{brl(s.toSettle)}</span>
              </div>
            </div>
          ))}
          {statements.length === 0 && (
            <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
              {courierId === "all"
                ? "Nenhum motoboy com rota no período."
                : "Esse motoboy não teve rota no período."}
            </p>
          )}
        </div>
      </section>

      <DeliveryProofs courierId={courierId === "all" ? null : courierId} from={from} to={to} nameOf={nameOf} />

      <div style={{ position: "fixed", left: "-9999px", top: 0 }}>
        <CourierStatementPrint
          ref={statementRef}
          couriers={statements}
          from={from}
          to={to}
          paperWidth={statementPaperWidth}
        />
      </div>
    </AppShell>
  );
}
