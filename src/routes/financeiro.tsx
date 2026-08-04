import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Wallet, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
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

      {isAdmin && <CostSettings />}
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

function CostSettings() {
  const qc = useQueryClient();
  const [novo, setNovo] = useState({ name: "", monthly_amount: "" });

  const { data: offers = [] } = useQuery({
    queryKey: ["offers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("offers").select("*").order("item_count");
      if (error) throw error;
      return data;
    },
  });

  const { data: costs = [] } = useQuery({
    queryKey: ["offer-costs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("offer_costs").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: fixed = [] } = useQuery({
    queryKey: ["fixed-costs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_costs")
        .select("*")
        .eq("active", true)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const saveKit = useMutation({
    mutationFn: async ({ offerId, value }: { offerId: string; value: number }) => {
      const { error } = await supabase
        .from("offer_costs")
        .upsert(
          { offer_id: offerId, kit_cost: value, updated_at: new Date().toISOString() },
          { onConflict: "offer_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Custo salvo");
      qc.invalidateQueries({ queryKey: ["offer-costs"] });
      qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addFixed = useMutation({
    mutationFn: async () => {
      const value = Number(novo.monthly_amount || 0);
      if (!novo.name.trim()) throw new Error("Dê um nome ao custo");
      const { error } = await supabase
        .from("fixed_costs")
        .insert({ name: novo.name.trim(), monthly_amount: value });
      if (error) throw error;
    },
    onSuccess: () => {
      setNovo({ name: "", monthly_amount: "" });
      qc.invalidateQueries({ queryKey: ["fixed-costs"] });
      qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateFixed = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number }) => {
      const { error } = await supabase
        .from("fixed_costs")
        .update({ monthly_amount: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Custo atualizado");
      qc.invalidateQueries({ queryKey: ["fixed-costs"] });
      qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeFixed = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fixed_costs").update({ active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fixed-costs"] });
      qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const kitOf = (offerId: string) =>
    costs.find((c) => c.offer_id === offerId)?.kit_cost ?? "";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Custo por oferta</h2>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Quanto custa montar um kit inteiro, não por perfume. Venda avulsa não usa este campo — ela
          calcula pelo preço de custo de cada produto no cadastro.
        </p>
        <div className="space-y-3">
          {offers.map((o) => (
            <div key={o.id} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">{o.name}</Label>
                <Input
                  type="number"
                  step="0.01"
                  defaultValue={kitOf(o.id)}
                  placeholder="0,00"
                  onBlur={(e) => {
                    const v = Number(e.target.value || 0);
                    if (v !== Number(kitOf(o.id) || 0)) saveKit.mutate({ offerId: o.id, value: v });
                  }}
                />
              </div>
              <p className="pb-2.5 text-xs text-muted-foreground">
                vende por {brl(Number(o.price))}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <Wallet className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Custos fixos mensais</h2>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Folha, aluguel, contador. O valor é rateado por dia no período consultado.
        </p>

        <div className="space-y-2">
          {fixed.map((f) => (
            <div key={f.id} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">{f.name}</Label>
                <Input
                  type="number"
                  step="0.01"
                  defaultValue={f.monthly_amount}
                  onBlur={(e) => {
                    const v = Number(e.target.value || 0);
                    if (v !== Number(f.monthly_amount)) updateFixed.mutate({ id: f.id, value: v });
                  }}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="mb-0.5"
                onClick={() => removeFixed.mutate(f.id)}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-end gap-2 border-t border-border pt-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">Novo custo</Label>
            <Input
              placeholder="Aluguel"
              value={novo.name}
              onChange={(e) => setNovo({ ...novo, name: e.target.value })}
            />
          </div>
          <div className="w-28 space-y-1.5">
            <Label className="text-xs">Mensal</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="0,00"
              value={novo.monthly_amount}
              onChange={(e) => setNovo({ ...novo, monthly_amount: e.target.value })}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            className="mb-0.5"
            disabled={addFixed.isPending}
            onClick={() => addFixed.mutate()}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </section>
    </div>
  );
}
