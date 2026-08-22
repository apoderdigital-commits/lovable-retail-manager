import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Minus,
  Plus,
  Search,
  Trash2,
  CheckCircle2,
  Truck,
  Sparkles,
  Repeat,
  LayoutGrid,
  List,
  Tags,
} from "lucide-react";
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
import { MultiSelect } from "@/components/ui/multi-select";
import { CustomerPicker } from "@/components/customer-picker";
import { ReceiptSheet } from "@/components/receipt/ReceiptSheet";

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
type Origin = "organic" | "traffic";

// dias inteiros desde a data, para o "última há N dias"
const dias = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

const payments = ["dinheiro", "pix", "débito", "crédito", "boleto"];

function PdvPage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("counter");
  const [term, setTerm] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  // guarda só id e quantidade: o preço é derivado do tipo do cliente,
  // então trocar o cliente reprecifica o carrinho inteiro sozinho
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>([]);
  // orgânico = venda direta. tráfego = veio de campanha — qual campanha
  // exatamente é descoberto pelo valor do carrinho, não escolhido à mão.
  const [origin, setOrigin] = useState<Origin>("organic");
  const [customerId, setCustomerId] = useState("none");
  const [payment, setPayment] = useState("dinheiro");
  const [discount, setDiscount] = useState("0");
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null);

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
        .select("id, name, phone, document, customer_type, address, neighborhood")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["product-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("product_categories").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: offers = [] } = useQuery({
    queryKey: ["offers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offers")
        .select("*")
        .eq("active", true)
        .order("item_count");
      if (error) throw error;
      return data;
    },
  });

  // histórico do cliente: o atendente precisa saber na hora se está
  // atendendo alguém novo ou um cliente que já volta há tempo
  const { data: stats } = useQuery({
    queryKey: ["customer-stats", customerId],
    enabled: customerId !== "none",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_stats", { p_customer: customerId });
      if (error) throw error;
      return data as { orders: number; total_spent: number; last_order_at: string | null };
    },
  });

  const customer = customers.find((c) => c.id === customerId) ?? null;
  const isWholesale = customer?.customer_type === "wholesale";

  // preço sempre vem da tabela do cliente — oferta não muda o preço, só
  // classifica de onde a venda veio
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
        .filter((p) => `${p.name} ${p.sku ?? ""}`.toLowerCase().includes(term.toLowerCase()))
        .filter(
          (p) => categoryFilter.length === 0 || categoryFilter.includes(p.category_id ?? ""),
        )
        .slice(0, 12),
    [products, term, categoryFilter],
  );

  const lines = cart.flatMap((i) => {
    const p = products.find((x) => x.id === i.productId);
    return p ? [{ ...i, product: p, unit: priceOf(p) }] : [];
  });

  const units = cart.reduce((s, i) => s + i.quantity, 0);

  const subtotal = lines.reduce((s, l) => s + l.unit * l.quantity, 0);
  const discountValue = Math.min(Number(discount || 0), subtotal);
  const total = subtotal - discountValue;

  // qual oferta esse carrinho representa, descoberto pela combinação de
  // quantidade de itens e valor total — "4 itens por R$100" só bate se os
  // dois baterem, não só o valor
  const matchedOffer =
    cart.length > 0
      ? offers.find((o) => o.item_count === units && Math.abs(Number(o.price) - subtotal) < 0.01)
      : undefined;

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
    setOrigin("organic");
    setDiscount("0");
    setCustomerId("none");
    setAddress("");
    setNeighborhood("");
  };

  const finish = useMutation({
    mutationFn: async (counterSale: boolean) => {
      // o banco calcula o total de verdade, reserva o estoque e aplica o
      // preço da tabela do cliente. o que está na tela é só prévia.
      const addr = counterSale ? "" : address.trim();
      const hood = counterSale ? "" : neighborhood.trim();
      const { data, error } = await supabase.rpc("create_order", {
        p_customer: (customerId === "none" ? null : customerId) as unknown as string,
        p_payment_method: payment,
        p_items: cart.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
        ...(addr ? { p_address: addr } : {}),
        ...(hood ? { p_neighborhood: hood } : {}),
        ...(origin === "traffic" && matchedOffer ? { p_offer: matchedOffer.id } : {}),
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
      setReceiptSaleId(sale.id);
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
  const missingOfferMatch = origin === "traffic" && !matchedOffer;
  const blocked =
    finish.isPending ||
    cart.length === 0 ||
    missingOfferMatch ||
    missingCustomer ||
    missingAddress;

  return (
    <AppShell
      title="Nova venda"
      subtitle={
        origin === "traffic" && matchedOffer
          ? `${matchedOffer.name} · tráfego`
          : isWholesale
            ? "Preços de atacado aplicados"
            : "Preços de varejo"
      }
    >
      <div className="grid gap-5 lg:grid-cols-5">
        <section className="panel lg:col-span-3">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <div className="flex min-w-40 flex-1 items-center gap-2">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Buscar produto por nome ou código"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </div>
            <MultiSelect
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              selected={categoryFilter}
              onChange={setCategoryFilter}
              placeholder="Categoria"
              allLabel="Todas as categorias"
              icon={<Tags className="size-3.5" />}
            />
            <div className="flex shrink-0 gap-0.5 rounded-md border border-border p-0.5">
              <button
                onClick={() => setView("grid")}
                className={`rounded px-2 py-1 transition-colors ${
                  view === "grid" ? "bg-secondary" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <LayoutGrid className="size-3.5" />
              </button>
              <button
                onClick={() => setView("list")}
                className={`rounded px-2 py-1 transition-colors ${
                  view === "list" ? "bg-secondary" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <List className="size-3.5" />
              </button>
            </div>
          </div>

          {view === "grid" ? (
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
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => add(p)}
                  disabled={(p.available_stock ?? 0) <= 0}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {categories.find((c) => c.id === p.category_id)?.name ?? "Sem categoria"}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {p.available_stock ?? 0} disp.
                  </span>
                  <span className="shrink-0 font-display text-sm font-semibold">
                    {brl(priceOf(p))}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum produto encontrado.
                </p>
              )}
            </div>
          )}
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

          <div className="border-b border-border p-3">
            <div className="flex gap-1.5">
              {(
                [
                  { v: "organic", label: "Orgânico" },
                  { v: "traffic", label: "Tráfego" },
                ] as const
              ).map((t) => (
                <button
                  key={t.v}
                  onClick={() => setOrigin(t.v)}
                  className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                    origin === t.v
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {origin === "traffic" ? (
              matchedOffer ? (
                <p className="mt-2 text-xs text-success">
                  Bate com a oferta <strong>{matchedOffer.name}</strong> — {units} item(ns) ·{" "}
                  {brl(subtotal)}.
                </p>
              ) : (
                <p className="mt-2 text-xs text-warning">
                  O valor precisa bater com uma oferta ativa (ex.: 4 itens por R$ 100 ou 10 por
                  R$ 200) para contar como tráfego. Ajuste os itens ou marque como Orgânico.
                </p>
              )
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Venda orgânica, fora do tráfego.</p>
            )}
          </div>

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
              <CustomerPicker
                customers={customers}
                value={customerId}
                onChange={selectCustomer}
                allowNone={mode !== "delivery"}
              />
              {customerId !== "none" && stats && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {Number(stats.orders) === 0 ? (
                    <Badge className="border-transparent bg-accent text-accent-foreground">
                      <Sparkles className="mr-1 size-3" /> Novo cliente
                    </Badge>
                  ) : (
                    <Badge className="border-transparent bg-success text-success-foreground">
                      <Repeat className="mr-1 size-3" />
                      {Number(stats.orders) + 1}º pedido na sua loja
                    </Badge>
                  )}
                  {isWholesale && <Badge variant="secondary">Tabela de atacado</Badge>}
                  {Number(stats.orders) > 0 && (
                    <span className="text-xs text-muted-foreground">
                      já gastou {brl(Number(stats.total_spent))}
                      {stats.last_order_at && ` · última há ${dias(stats.last_order_at)} dia(s)`}
                    </span>
                  )}
                </div>
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
                <span>{origin === "traffic" && matchedOffer ? matchedOffer.name : "Subtotal"}</span>
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
      <ReceiptSheet saleId={receiptSaleId} onClose={() => setReceiptSaleId(null)} />
    </AppShell>
  );
}
