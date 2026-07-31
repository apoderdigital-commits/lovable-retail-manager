import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Minus, Plus, Search, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
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
import { brl } from "@/lib/format";

export const Route = createFileRoute("/pdv")({
  head: () => ({
    meta: [
      { title: "Nova venda (PDV) — Varejo360" },
      {
        name: "description",
        content: "Registre vendas rapidamente, escolha a forma de pagamento e baixe o estoque.",
      },
      { property: "og:title", content: "Nova venda (PDV) — Varejo360" },
      {
        property: "og:description",
        content: "Registre vendas rapidamente, escolha a forma de pagamento e baixe o estoque.",
      },
    ],
  }),
  component: PdvPage,
});

type CartItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  stock: number;
};

const payments = ["dinheiro", "pix", "débito", "crédito", "boleto"];

function PdvPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState<string>("none");
  const [payment, setPayment] = useState("dinheiro");
  const [discount, setDiscount] = useState("0");

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(
    () =>
      products
        .filter((p) =>
          `${p.name} ${p.sku ?? ""} ${p.category ?? ""}`.toLowerCase().includes(term.toLowerCase()),
        )
        .slice(0, 12),
    [products, term],
  );

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const discountValue = Math.min(Number(discount || 0), subtotal);
  const total = subtotal - discountValue;

  const add = (p: (typeof products)[number]) => {
    if (p.stock <= 0) {
      toast.error("Produto sem estoque");
      return;
    }
    setCart((prev) => {
      const found = prev.find((i) => i.productId === p.id);
      if (found) {
        if (found.quantity >= p.stock) {
          toast.error("Quantidade acima do estoque disponível");
          return prev;
        }
        return prev.map((i) =>
          i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      return [
        ...prev,
        { productId: p.id, name: p.name, price: Number(p.price), quantity: 1, stock: p.stock },
      ];
    });
  };

  const changeQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) =>
          i.productId === productId
            ? { ...i, quantity: Math.min(Math.max(i.quantity + delta, 0), i.stock) }
            : i,
        )
        .filter((i) => i.quantity > 0),
    );
  };

  const finish = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) throw new Error("Adicione produtos à venda");
      if (!user) throw new Error("Sessão expirada");
      const { data: sale, error } = await supabase
        .from("sales")
        .insert({
          customer_id: customerId === "none" ? null : customerId,
          seller_id: user.id,
          subtotal,
          discount: discountValue,
          total,
          payment_method: payment,
        })
        .select("id, sale_number")
        .single();
      if (error) throw error;

      const { error: itemsError } = await supabase.from("sale_items").insert(
        cart.map((i) => ({
          sale_id: sale.id,
          product_id: i.productId,
          product_name: i.name,
          quantity: i.quantity,
          unit_price: i.price,
          total: i.price * i.quantity,
        })),
      );
      if (itemsError) throw itemsError;
      return sale;
    },
    onSuccess: (sale) => {
      toast.success(`Venda #${sale.sale_number} registrada — ${brl(total)}`);
      setCart([]);
      setDiscount("0");
      setCustomerId("none");
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Nova venda" subtitle="Ponto de venda rápido">
      <div className="grid gap-5 lg:grid-cols-5">
        <section className="panel lg:col-span-3">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Buscar produto por nome ou código"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-2">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => add(p)}
                className="flex flex-col items-start rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-accent"
              >
                <span className="text-sm font-medium">{p.name}</span>
                <span className="mt-1 font-display text-base font-semibold">
                  {brl(Number(p.price))}
                </span>
                <span className="text-xs text-muted-foreground">{p.stock} em estoque</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                Nenhum produto disponível. Cadastre produtos primeiro.
              </p>
            )}
          </div>
        </section>

        <section className="panel flex flex-col lg:col-span-2">
          <header className="border-b border-border px-4 py-3">
            <h2 className="font-display text-base font-semibold">Carrinho</h2>
          </header>
          <div className="flex-1 divide-y divide-border">
            {cart.map((i) => (
              <div key={i.productId} className="flex items-center gap-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {brl(i.price)} × {i.quantity} = {brl(i.price * i.quantity)}
                  </p>
                </div>
                <Button variant="outline" size="icon" onClick={() => changeQty(i.productId, -1)}>
                  <Minus className="size-3.5" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => changeQty(i.productId, 1)}>
                  <Plus className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCart((p) => p.filter((x) => x.productId !== i.productId))}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
            {cart.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Selecione produtos ao lado.
              </p>
            )}
          </div>

          <div className="space-y-3 border-t border-border p-4">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Consumidor final</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Pagamento</Label>
                <Select value={payment} onValueChange={setPayment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {payments.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Desconto (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-lg bg-secondary p-3 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{brl(subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Desconto</span>
                <span>-{brl(discountValue)}</span>
              </div>
              <div className="mt-1 flex justify-between font-display text-lg font-semibold">
                <span>Total</span>
                <span>{brl(total)}</span>
              </div>
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={finish.isPending || cart.length === 0}
              onClick={() => finish.mutate()}
            >
              <CheckCircle2 className="mr-2 size-4" /> Finalizar venda
            </Button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
