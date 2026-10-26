// troca a partir de uma venda concluída. Quem mexe no estoque é a
// register_exchange no banco; aqui é só a prévia e o formulário.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { brl } from "@/lib/format";

const KINDS = [
  { value: "troca", label: "Troca" },
  { value: "defeito", label: "Defeito" },
  { value: "fragrancia", label: "Troca de fragrância" },
] as const;

const PAYMENTS = ["dinheiro", "pix", "débito", "crédito"];

export type ExchangeSale = {
  id: string;
  sale_number: number;
  customers: { customer_type?: string | null } | null;
};

export function ExchangeDialog({
  sale,
  onClose,
}: {
  sale: ExchangeSale | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<string>("troca");
  const [returnedId, setReturnedId] = useState("");
  const [returnedQty, setReturnedQty] = useState("1");
  const [search, setSearch] = useState("");
  const [givenId, setGivenId] = useState("");
  const [givenQty, setGivenQty] = useState("1");
  const [payment, setPayment] = useState("pix");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setKind("troca");
    setReturnedId("");
    setReturnedQty("1");
    setSearch("");
    setGivenId("");
    setGivenQty("1");
    setPayment("pix");
    setNotes("");
  }, [sale?.id]);

  const { data: items = [] } = useQuery({
    queryKey: ["exchange-items", sale?.id],
    enabled: !!sale,
    queryFn: async () => {
      const [{ data: rows, error }, { data: done, error: e2 }] = await Promise.all([
        supabase
          .from("sale_items")
          .select("product_id, product_name, quantity, total")
          .eq("sale_id", sale!.id),
        supabase
          .from("sale_exchanges" as never)
          .select("returned_product_id, returned_qty")
          .eq("sale_id", sale!.id),
      ]);
      if (error) throw error;
      if (e2) throw e2;
      // mesmo produto pode vir em duas linhas (parte no kit, parte normal)
      const map = new Map<string, { id: string; name: string; qty: number; paid: number; left: number }>();
      for (const r of rows ?? []) {
        if (!r.product_id) continue;
        const cur = map.get(r.product_id) ?? { id: r.product_id, name: r.product_name, qty: 0, paid: 0, left: 0 };
        cur.qty += r.quantity;
        cur.paid += Number(r.total);
        map.set(r.product_id, cur);
      }
      for (const v of map.values()) v.left = v.qty;
      for (const d of (done ?? []) as { returned_product_id: string; returned_qty: number }[]) {
        const cur = map.get(d.returned_product_id);
        if (cur) cur.left -= d.returned_qty;
      }
      return [...map.values()].filter((v) => v.left > 0);
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["exchange-products"],
    enabled: !!sale,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, price, wholesale_price, available_stock")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const returned = items.find((i) => i.id === returnedId);
  const given = products.find((p) => p.id === givenId);
  const rQty = Math.max(0, Math.floor(Number(returnedQty) || 0));
  const gQty = Math.max(0, Math.floor(Number(givenQty) || 0));

  // mesma conta do banco: devolvido vale o que o cliente pagou por unidade,
  // o novo vale o preço de hoje da tabela do cliente
  const wholesale = sale?.customers?.customer_type === "wholesale";
  const returnedValue = returned ? Math.round((returned.paid / returned.qty) * rQty * 100) / 100 : 0;
  const givenValue = given ? gQty * Number(wholesale ? given.wholesale_price : given.price) : 0;
  const diff = Math.round((givenValue - returnedValue) * 100) / 100;

  const filteredProducts = useMemo(() => {
    const t = search.trim().toLowerCase();
    return products.filter(
      (p) => p.id === givenId || ((p.available_stock ?? 0) > 0 && (!t || p.name.toLowerCase().includes(t))),
    );
  }, [products, search, givenId]);

  const invalid =
    !returned || !given || rQty <= 0 || gQty <= 0 || rQty > returned.left;

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("register_exchange" as never, {
        p_sale: sale!.id,
        p_kind: kind,
        p_returned_product: returnedId,
        p_returned_qty: rQty,
        p_given_product: givenId,
        p_given_qty: gQty,
        p_payment: diff !== 0 ? payment : null,
        p_notes: notes.trim() || null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Troca registrada");
      qc.invalidateQueries({ queryKey: ["sale-exchanges"] });
      qc.invalidateQueries({ queryKey: ["exchange-items"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["exchange-products"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!sale} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Troca · venda #{sale?.sale_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {kind === "defeito"
                ? "O devolvido não volta pra venda: entra e sai como baixa por defeito."
                : "O devolvido volta pro estoque."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>O que o cliente devolve</Label>
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <Select value={returnedId} onValueChange={setReturnedId}>
                <SelectTrigger>
                  <SelectValue placeholder="Item da venda" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name} · {i.left} un.
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                max={returned?.left}
                value={returnedQty}
                onChange={(e) => setReturnedQty(e.target.value)}
              />
            </div>
            {items.length === 0 && (
              <p className="text-xs text-muted-foreground">Nada mais pra trocar nesta venda.</p>
            )}
            {returned && rQty > returned.left && (
              <p className="text-xs text-destructive">Só restam {returned.left} unidade(s).</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>O que sai no lugar</Label>
            <Input
              placeholder="Buscar produto"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <Select value={givenId} onValueChange={setGivenId}>
                <SelectTrigger>
                  <SelectValue placeholder="Produto novo" />
                </SelectTrigger>
                <SelectContent>
                  {filteredProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.available_stock ?? 0} em estoque
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                value={givenQty}
                onChange={(e) => setGivenQty(e.target.value)}
              />
            </div>
          </div>

          {returned && given && (
            <div className="space-y-2 rounded-md border border-border p-3 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Devolvido</span>
                <span>{brl(returnedValue)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Novo</span>
                <span>{brl(givenValue)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <span>
                  {diff > 0 ? "Cliente paga" : diff < 0 ? "Loja devolve" : "Sem diferença"}
                </span>
                <span>{brl(Math.abs(diff))}</span>
              </div>
              {diff !== 0 && (
                <Select value={payment} onValueChange={setPayment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENTS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Observação</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: válvula com vazamento, cliente preferiu outra fragrância..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button disabled={invalid || save.isPending} onClick={() => save.mutate()}>
            Registrar troca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
