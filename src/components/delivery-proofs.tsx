// lista das entregas do período com a foto do comprovante — é aqui que a
// loja confere, no fechamento, onde cada pix caiu
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { brl, dayBr } from "@/lib/format";

type ProofRow = {
  id: string;
  sale_number: number;
  total: number;
  payment_method: string;
  payment_method_2: string | null;
  payment_amount_2: number;
  pix_to: "maquina" | "entregador" | null;
  proof_url: string | null;
  customers: { name: string } | null;
  routes: { date: string; courier_id: string };
};

type Filter = "all" | "entregador" | "maquina";

const PIX_LABEL = { maquina: "pix máquina", entregador: "pix entregador" } as const;

const methodLabel = (method: string, pixTo: ProofRow["pix_to"]) =>
  method === "pix" && pixTo ? PIX_LABEL[pixTo] : method;

export function DeliveryProofs({
  courierId,
  from,
  to,
  nameOf,
}: {
  courierId: string | null;
  from: string;
  to: string;
  nameOf: (id: string) => string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [viewing, setViewing] = useState<{ url: string; title: string } | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["delivery-proofs", courierId, from, to],
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select(
          "id, sale_number, total, payment_method, payment_method_2, payment_amount_2, pix_to, proof_url, customers(name), routes!inner(date, courier_id)",
        )
        .eq("status", "delivered")
        .gte("routes.date", from)
        .lte("routes.date", to)
        .order("sale_number", { ascending: false });
      if (courierId) q = q.eq("routes.courier_id", courierId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ProofRow[];
    },
  });

  const shown = rows.filter((r) => filter === "all" || r.pix_to === filter);

  const open = async (r: ProofRow) => {
    if (!r.proof_url) return;
    // bucket privado: a foto só abre por URL assinada, de validade curta
    const { data, error } = await supabase.storage
      .from("delivery-proofs")
      .createSignedUrl(r.proof_url, 300);
    if (error || !data) {
      toast.error("Não foi possível abrir o comprovante");
      return;
    }
    setViewing({ url: data.signedUrl, title: `Pedido #${r.sale_number}` });
  };

  return (
    <section className="panel mt-4 overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Comprovantes das entregas</h2>
        <div className="flex gap-1">
          {(
            [
              ["all", "Todas"],
              ["entregador", "Pix entregador"],
              ["maquina", "Pix máquina"],
            ] as [Filter, string][]
          ).map(([v, label]) => (
            <Button
              key={v}
              size="sm"
              variant={filter === v ? "default" : "outline"}
              className="h-8"
              onClick={() => setFilter(v)}
            >
              {label}
            </Button>
          ))}
        </div>
      </header>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pedido</TableHead>
            <TableHead>Dia</TableHead>
            {!courierId && <TableHead>Motoboy</TableHead>}
            <TableHead>Cliente</TableHead>
            <TableHead>Pagamento</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead className="text-right">Comprovante</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => {
            const second = Number(r.payment_amount_2 ?? 0);
            return (
              <TableRow key={r.id}>
                <TableCell className="font-medium">#{r.sale_number}</TableCell>
                <TableCell className="text-muted-foreground">{dayBr(r.routes.date)}</TableCell>
                {!courierId && (
                  <TableCell className="text-muted-foreground">{nameOf(r.routes.courier_id)}</TableCell>
                )}
                <TableCell>{r.customers?.name ?? "Consumidor final"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge
                      variant={r.payment_method === "pix" && r.pix_to === "entregador" ? "default" : "secondary"}
                      className="capitalize"
                    >
                      {methodLabel(r.payment_method, r.pix_to)}
                      {r.payment_method_2 ? ` ${brl(Number(r.total) - second)}` : ""}
                    </Badge>
                    {r.payment_method_2 && (
                      <Badge
                        variant={
                          r.payment_method_2 === "pix" && r.pix_to === "entregador" ? "default" : "secondary"
                        }
                        className="capitalize"
                      >
                        {methodLabel(r.payment_method_2, r.pix_to)} {brl(second)}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium">{brl(Number(r.total))}</TableCell>
                <TableCell className="text-right">
                  {r.proof_url ? (
                    <Button variant="ghost" size="sm" onClick={() => open(r)}>
                      <ImageIcon className="mr-1.5 size-4" /> Ver
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {shown.length === 0 && !isLoading && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                Nenhuma entrega no período.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.title}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <a href={viewing.url} target="_blank" rel="noreferrer">
              <img src={viewing.url} alt="Comprovante da entrega" className="max-h-[70vh] w-full rounded-md object-contain" />
            </a>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
