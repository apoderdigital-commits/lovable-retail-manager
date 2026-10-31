import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Wallet, SlidersHorizontal, ArrowLeft, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/custos")({
  head: () => ({
    meta: [
      { title: "Custos — Vieira Perfumes" },
      {
        name: "description",
        content: "Custos fixos mensais usados no cálculo da margem; o custo dos produtos vem do cadastro.",
      },
    ],
  }),
  component: CostsPage,
});

function CostsPage() {
  const { isAdmin } = useAuth();
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

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["fixed-costs"] });
    qc.invalidateQueries({ queryKey: ["finance"] });
  };

  const addFixed = useMutation({
    mutationFn: async () => {
      if (!novo.name.trim()) throw new Error("Dê um nome ao custo");
      const { error } = await supabase
        .from("fixed_costs")
        .insert({ name: novo.name.trim(), monthly_amount: Number(novo.monthly_amount || 0) });
      if (error) throw error;
    },
    onSuccess: () => {
      setNovo({ name: "", monthly_amount: "" });
      refresh();
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
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeFixed = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fixed_costs").update({ active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const voltar = (
    <Button variant="outline" size="sm" asChild>
      <Link to="/financeiro">
        <ArrowLeft className="mr-1.5 size-3.5" /> Voltar ao financeiro
      </Link>
    </Button>
  );

  if (!isAdmin) {
    return (
      <AppShell title="Custos" actions={voltar}>
        <div className="panel p-8 text-center">
          <Lock className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Área restrita</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Só administradores alteram os custos que entram no cálculo da margem.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Custos"
      subtitle="Entram no cálculo da margem no Financeiro"
      actions={voltar}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Custo dos produtos</h2>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            O Financeiro calcula o custo de cada venda pela quantidade vendida vezes o campo
            "Custo" de cada produto, em kit ou avulso. Não há custo por oferta: preencha o custo
            no cadastro de cada produto.
          </p>
          <div className="space-y-2 text-xs text-muted-foreground">
            {offers.map((o) => (
              <p key={o.id}>
                {o.name}: vende por {brl(Number(o.price))} · custo = soma dos {o.item_count} produtos
                do kit
              </p>
            ))}
          </div>
          <Button variant="outline" size="sm" className="mt-4" asChild>
            <Link to="/produtos">Abrir cadastro de produtos</Link>
          </Button>
        </section>

        <section className="panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <Wallet className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Custos fixos mensais</h2>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            Folha, aluguel, contador. O valor é rateado por dia no período consultado, então
            consultar meia quinzena cobra metade.
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

          <p className="mt-3 text-xs text-muted-foreground">
            Remover não apaga o histórico: o custo deixa de contar a partir de agora, e períodos já
            consultados antes disso mudam junto. Não há registro de quando o valor era outro.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
