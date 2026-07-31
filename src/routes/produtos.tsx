import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, StockBadge } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/produtos")({
  head: () => ({
    meta: [
      { title: "Produtos e estoque — Varejo360" },
      {
        name: "description",
        content: "Cadastre produtos, defina preços e acompanhe o estoque mínimo da loja.",
      },
      { property: "og:title", content: "Produtos e estoque — Varejo360" },
      {
        property: "og:description",
        content: "Cadastre produtos, defina preços e acompanhe o estoque mínimo da loja.",
      },
    ],
  }),
  component: ProductsPage,
});

type ProductForm = {
  id?: string;
  name: string;
  sku: string;
  category: string;
  cost_price: string;
  price: string;
  wholesale_price: string;
  stock: string;
  min_stock: string;
};

const empty: ProductForm = {
  name: "",
  sku: "",
  category: "",
  cost_price: "",
  price: "",
  wholesale_price: "",
  stock: "0",
  min_stock: "0",
};

const schema = z.object({
  name: z.string().trim().min(2, { message: "Informe o nome do produto" }).max(120),
  sku: z.string().trim().max(60),
  category: z.string().trim().max(60),
  price: z.number().nonnegative(),
  wholesale_price: z.number().nonnegative(),
  cost_price: z.number().nonnegative(),
  stock: z.number().int().min(0),
  min_stock: z.number().int().min(0),
});

function ProductsPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>(empty);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async (input: ProductForm) => {
      const parsed = schema.safeParse({
        name: input.name,
        sku: input.sku,
        category: input.category,
        price: Number(input.price || 0),
        wholesale_price: Number(input.wholesale_price || input.price || 0),
        cost_price: Number(input.cost_price || 0),
        stock: Number(input.stock || 0),
        min_stock: Number(input.min_stock || 0),
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      const payload = {
        ...parsed.data,
        sku: parsed.data.sku || null,
        category: parsed.data.category || null,
      };
      if (input.id) {
        const { error } = await supabase.from("products").update(payload).eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Produto salvo");
      setOpen(false);
      setForm(empty);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Produto excluído");
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: () => toast.error("Não foi possível excluir o produto"),
  });

  const filtered = products.filter((p) =>
    `${p.name} ${p.sku ?? ""} ${p.category ?? ""}`.toLowerCase().includes(term.toLowerCase()),
  );

  const openEdit = (p: (typeof products)[number]) => {
    setForm({
      id: p.id,
      name: p.name,
      sku: p.sku ?? "",
      category: p.category ?? "",
      cost_price: String(p.cost_price),
      price: String(p.price),
      wholesale_price: String(p.wholesale_price),
      stock: String(p.stock),
      min_stock: String(p.min_stock),
    });
    setOpen(true);
  };

  return (
    <AppShell
      title="Produtos e estoque"
      subtitle={`${products.length} item(ns) cadastrado(s)`}
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setForm(empty)}>
              <Plus className="mr-2 size-4" /> Novo produto
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{form.id ? "Editar produto" : "Novo produto"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Nome</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Código / SKU</Label>
                <Input
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Preço de custo</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.cost_price}
                  onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Preço varejo</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Preço atacado</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="igual ao varejo se vazio"
                  value={form.wholesale_price}
                  onChange={(e) => setForm({ ...form, wholesale_price: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Estoque físico</Label>
                <Input
                  type="number"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                />
                {form.id && (
                  <p className="text-xs text-muted-foreground">
                    O disponível é calculado pelo banco: físico menos reservado.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Estoque mínimo</Label>
                <Input
                  type="number"
                  value={form.min_stock}
                  onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button disabled={save.isPending} onClick={() => save.mutate(form)}>
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="panel overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Buscar por nome, código ou categoria"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead className="text-right">Custo</TableHead>
              <TableHead className="text-right">Varejo</TableHead>
              <TableHead className="text-right">Atacado</TableHead>
              <TableHead className="text-right">Disponível</TableHead>
              <TableHead className="text-right">Físico</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <p className="font-medium">{p.name}</p>
                  {p.sku && <p className="text-xs text-muted-foreground">{p.sku}</p>}
                </TableCell>
                <TableCell className="text-muted-foreground">{p.category ?? "—"}</TableCell>
                <TableCell className="text-right">{brl(Number(p.cost_price))}</TableCell>
                <TableCell className="text-right font-medium">{brl(Number(p.price))}</TableCell>
                <TableCell className="text-right">{brl(Number(p.wholesale_price))}</TableCell>
                <TableCell className="text-right">
                  <span className="font-medium">{p.available_stock}</span>
                  {p.reserved_stock > 0 && (
                    <p className="text-xs text-muted-foreground">{p.reserved_stock} reservado(s)</p>
                  )}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{p.stock}</TableCell>
                <TableCell>
                  <StockBadge stock={p.available_stock} min={p.min_stock} />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                    <Pencil className="size-4" />
                  </Button>
                  {isAdmin && (
                    <Button variant="ghost" size="icon" onClick={() => remove.mutate(p.id)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  Nenhum produto encontrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  );
}
