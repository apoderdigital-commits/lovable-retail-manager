import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Combobox } from "@/components/ui/combobox";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  document: string | null;
  customer_type: string;
};

/**
 * Busca de cliente para o PDV: acha por nome, telefone ou documento, e tem
 * uma saída rápida para cadastrar quem chegou pela primeira vez sem sair da
 * tela de venda. Cadastro completo (endereço, observações) continua em
 * /clientes — aqui é só o mínimo pra fechar a venda.
 */
export function CustomerPicker({
  customers,
  value,
  onChange,
  allowNone = true,
  noneLabel = "Consumidor final",
}: {
  customers: Customer[];
  value: string;
  onChange: (id: string) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const qc = useQueryClient();
  const [quickAdd, setQuickAdd] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", customer_type: "retail" as "retail" | "wholesale" });

  const options = [
    ...(allowNone ? [{ value: "none", label: noneLabel }] : []),
    ...customers.map((c) => ({
      value: c.id,
      label: `${c.name}${c.customer_type === "wholesale" ? " · atacado" : ""}`,
      keywords: `${c.phone ?? ""} ${c.document ?? ""}`,
    })),
  ];

  const create = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Informe o nome do cliente");
      const { data, error } = await supabase
        .from("customers")
        .insert({
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          customer_type: form.customer_type,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (customer) => {
      toast.success("Cliente cadastrado");
      qc.invalidateQueries({ queryKey: ["customers"] });
      onChange(customer.id);
      setQuickAdd(false);
      setForm({ name: "", phone: "", customer_type: "retail" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Combobox
        options={options}
        value={value}
        onChange={onChange}
        placeholder="Selecionar cliente"
        searchPlaceholder="Buscar por nome, telefone ou documento"
        emptyMessage="Nenhum cliente encontrado."
        footer={
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => setQuickAdd(true)}
          >
            <UserPlus className="mr-2 size-4" /> Cadastrar novo cliente
          </Button>
        }
      />

      <Dialog open={quickAdd} onOpenChange={setQuickAdd}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Telefone / WhatsApp</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={form.customer_type}
                onValueChange={(v) => setForm({ ...form, customer_type: v as "retail" | "wholesale" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="retail">Varejo</SelectItem>
                  <SelectItem value="wholesale">Atacado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Endereço e outros dados podem ser completados depois em Clientes.
            </p>
          </div>
          <DialogFooter>
            <Button disabled={create.isPending} onClick={() => create.mutate()}>
              <Plus className="mr-2 size-4" /> Cadastrar e selecionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
