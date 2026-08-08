import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import {
  CustomerFormFields,
  customerPayload,
  emptyCustomerForm,
  type CustomerFormValues,
} from "@/components/customer-form";
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
 * tela de venda — mesmo formulário completo de /clientes, porque cadastro
 * pela metade só vira ligação do motoboy perdido na rua depois.
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
  const [form, setForm] = useState<CustomerFormValues>(emptyCustomerForm);

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
      const payload = customerPayload(form);
      const { data, error } = await supabase.from("customers").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (customer) => {
      toast.success("Cliente cadastrado");
      qc.invalidateQueries({ queryKey: ["customers"] });
      onChange(customer.id);
      setQuickAdd(false);
      setForm(emptyCustomerForm);
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
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
          </DialogHeader>

          <CustomerFormFields form={form} onChange={setForm} />

          <DialogFooter>
            <Button disabled={create.isPending} onClick={() => create.mutate()}>
              Cadastrar e selecionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
