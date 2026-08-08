import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
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

export const Route = createFileRoute("/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes — Vieira Perfumes" },
      {
        name: "description",
        content: "Cadastro de clientes da loja com contato, documento e observações.",
      },
      { property: "og:title", content: "Clientes — Vieira Perfumes" },
      {
        property: "og:description",
        content: "Cadastro de clientes da loja com contato, documento e observações.",
      },
    ],
  }),
  component: CustomersPage,
});

function CustomersPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CustomerFormValues>(emptyCustomerForm);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async (input: CustomerFormValues) => {
      const payload = customerPayload(input);
      if (input.id) {
        const { error } = await supabase.from("customers").update(payload).eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("customers").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Cliente salvo");
      setOpen(false);
      setForm(emptyCustomerForm);
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente excluído");
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: () => toast.error("Não foi possível excluir o cliente"),
  });

  const filtered = customers.filter((c) =>
    `${c.name} ${c.phone ?? ""} ${c.email ?? ""} ${c.document ?? ""}`
      .toLowerCase()
      .includes(term.toLowerCase()),
  );

  return (
    <AppShell
      title="Clientes"
      subtitle={`${customers.length} cliente(s) cadastrado(s)`}
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setForm(emptyCustomerForm)}>
              <Plus className="mr-2 size-4" /> Novo cliente
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{form.id ? "Editar cliente" : "Novo cliente"}</DialogTitle>
            </DialogHeader>

            <CustomerFormFields form={form} onChange={setForm} />

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
            placeholder="Buscar cliente"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Bairro</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{c.email ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{c.neighborhood ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {c.customer_type === "wholesale" ? "Atacado" : "Varejo"}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setForm({
                        id: c.id,
                        name: c.name,
                        phone: c.phone ?? "",
                        email: c.email ?? "",
                        document: c.document ?? "",
                        birth_date: c.birth_date ?? "",
                        customer_type: c.customer_type ?? "retail",
                        zip_code: c.zip_code ?? "",
                        address: c.address ?? "",
                        neighborhood: c.neighborhood ?? "",
                        city: c.city ?? "",
                        reference_point: c.reference_point ?? "",
                        notes: c.notes ?? "",
                      });
                      setOpen(true);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  {isAdmin && (
                    <Button variant="ghost" size="icon" onClick={() => remove.mutate(c.id)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Nenhum cliente encontrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  );
}
