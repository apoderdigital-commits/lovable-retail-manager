import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Minus, Plus, Search, Trash2, CheckCircle2, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
      { title: "Nova venda — Vieira Perfumes" },
      {
        name: "description",
        content: "Registre vendas de balcão ou crie pedidos para entrega, com preço de varejo ou atacado.",
      },
      { property: "og:title", content: "Nova venda — Vieira Perfumes" },
      {
        property: "og:description",
        content: "Registre vendas de balcão ou crie pedidos para entrega, com preço de varejo ou atacado.",
      },
    ],
  }),
  component: PdvPage,
});

type Mode = "counter" | "delivery";

const payments = ["dinheiro", "pix", "débito", "crédito", "boleto"];

function PdvPage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("counter");
  const [term, setTerm] = useState("");
  // guarda só id e quantidade: o preço é derivado do tipo do cliente,
  // então trocar o cliente reprecifica o carrinho inteiro sozinho
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>([]);
  const [customerId, setCustomerId] = useState("none");
  const [payment, setPayment] = useState("dinheiro");
  const [discount, setDiscount] = useState("0");
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("");

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, customer_type, address, neighborhood")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const customer = customers.find((c) => c.id === customerId) ?? null;
  const isWholesale = customer?.customer_type === "wholesale";

  const priceOf = (p: (typeof products)[number]) =>
    Number(isWholesale ? p.wholesale_price : p.price);

  const selectCustomer = (id: string) => {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    setAddress(c?.address ?? "");
    setNeighborhood(c?.neighborhood ?? "");
  };

  const filtered = useMemo(
    () =>
      products
        .filter((p) =>
          `${p.name} ${p.sku ?? ""} ${p.category ?? ""}`.toLowerCase().includes(term.toLowerCase()),
        )
        .slice(0, 12),
    [products, term],
  );

  const lines = cart.flatMap((i) => {
    const p = products.find((x) => x.id === i.productId);
    return p ? [{ ...i, product: p, unit: priceOf(p) }] : [];
  });

  const subtotal = lines.reduce((s, l) => s + l.unit * l.quantity, 0);
  const discountValue = Math.min(Number(discount || 0), subtotal);
  const total = subtotal - discountValue;

  const add = (p: (typeof products)[number]) => {
    const inCart = cart.find((i) => i.productId === p.id)?.quantity ?? 0;
    if (inCart >= (p.available_stock ?? 0)) {
      toast.error(
        (p.available_stock ?? 0) <= 0
          ? "Produto sem estoque disponível"
          : `Só há ${p.available_stock ?? 0} disponível(is)`,
      );
      return;
    }
    setCart((prev) =>
      inCart
        ? prev.map((i) => (i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i))
        : [...prev, { productId: p.id, quantity: 1 }],
    );
  };

  const changeQty = (productId: string, delta: number) => {
    const p = products.find((x) => x.id === productId);
    setCart((prev) =>
      prev
        .map((i) =>
          i.productId === productId
            ? {
                ...i,
                quantity: Math.min(Math.max(i.quantity + delta, 0), p?.available_stock ?? 0),
              }
            : i,
        )
        .filter((i) => i.quantity > 0),
    );
  };

  const reset = () => {
    setCart([]);
    setDiscount("0");
    setCustomerId("none");
    setAddress("");
    setNeighborhood("");
  };

  const finish = useMutation({
    mutationFn: async (counterSale: boolean) => {
      // o banco calcula o total de verdade, reserva o estoque e aplica o
      // preço da tabela do cliente. o que está na tela é só prévia.
      const { data, error } = await supabase.rpc("create_order", {
        p_customer: customerId === "none" ? null : customerId,
        p_payment_method: payment,
        p_items: cart.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
        p_address: counterSale ? null : address.trim() || null,
        p_neighborhood: counterSale ? null : neighborhood.trim() || null,
        p_discount: discountValue,
        p_counter_sale: counterSale,
      });
      if (error) throw error;
      return { sale: data, counterSale };
    },
    onSuccess: ({ sale, counterSale }) => {
      toast.success(
        counterSale
          ? `Venda #${sale.sale_number} registrada — ${brl(Number(sale.total))}`
          : `Pedido #${sale.sale_number} criado — estoque reservado`,
      );
      reset();
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const missingCustomer = mode === "delivery" && customerId === "none";
  const missingAddress = mode === "delivery" && !address.trim();
  const blocked = finish.isPending || cart.length === 0 || missingCustomer || missingAddress;

  return (
    <AppShell
      title="Nova venda"
      subtitle={isWholesale ? "Preços de atacado aplicados" : "Preços de varejo"}
    >
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
                disabled={(p.available_stock ?? 0) <= 0}
                className="flex flex-col items-start rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-accent disabled:opacity-50"
              >
                <span className="text-sm font-medium">{p.name}</span>
                <span className="mt-1 font-display text-base font-semibold">
                  {brl(priceOf(p))}
                </span>
                <span className="text-xs text-muted-foreground">
                  {p.available_stock ?? 0} disponível(is)
                  {p.reserved_stock > 0 && ` · ${p.reserved_stock} reservado(s)`}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                Nenhum produto encontrado.
              </p>
            )}
          </div>
        </section>

        <section className="panel flex flex-col lg:col-span-2">
          <header className="flex gap-1 border-b border-border p-2">
            {(
              [
                { v: "counter", label: "Balcão" },
                { v: "delivery", label: "Entrega" },
              ] as const
            ).map((t) => (
              <button
                key={t.v}
                onClick={() => setMode(t.v)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  mode === t.v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </header>

          <div className="flex-1 divide-y divide-border">
            {lines.map((l) => (
              <div key={l.productId} className="flex items-center gap-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {brl(l.unit)} × {l.quantity} = {brl(l.unit * l.quantity)}
                  </p>
                </div>
                <Button variant="outline" size="icon" onClick={() => changeQty(l.productId, -1)}>
                  <Minus className="size-3.5" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => changeQty(l.productId, 1)}>
                  <Plus className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCart((p) => p.filter((x) => x.productId !== l.productId))}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
            {lines.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Selecione produtos ao lado.
              </p>
            )}
          </div>

          <div className="space-y-3 border-t border-border p-4">
            <div className="space-y-1.5">
              <Label>
                Cliente {mode === "delivery" && <span className="text-destructive">*</span>}
              </Label>
              <Select value={customerId} onValueChange={selectCustomer}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" disabled={mode === "delivery"}>
                    Consumidor final
                  </SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.customer_type === "wholesale" ? " · atacado" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isWholesale && (
                <Badge variant="secondary" className="mt-1">
                  Tabela de atacado
                </Badge>
              )}
            </div>

            {mode === "delivery" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>
                    Endereço de entrega <span className="text-destructive">*</span>
                  </Label>
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Bairro</Label>
                  <Input
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                    placeholder="define a taxa do entregador"
                  />
                </div>
              </div>
            )}

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

            {mode === "counter" ? (
              <Button
                className="w-full"
                size="lg"
                disabled={blocked}
                onClick={() => finish.mutate(true)}
              >
                <CheckCircle2 className="mr-2 size-4" /> Finalizar venda no balcão
              </Button>
            ) : (
              <>
                <Button
                  className="w-full"
                  size="lg"
                  disabled={blocked}
                  onClick={() => finish.mutate(false)}
                >
                  <Truck className="mr-2 size-4" /> Criar pedido para entrega
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  O estoque fica reservado até a entrega ser concluída.
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
