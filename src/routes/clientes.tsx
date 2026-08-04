import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pencil, Trash2, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

type Form = {
  id?: string;
  name: string;
  phone: string;
  email: string;
  document: string;
  customer_type: "retail" | "wholesale";
  zip_code: string;
  address: string;
  neighborhood: string;
  city: string;
  reference_point: string;
  notes: string;
};

const empty: Form = {
  name: "",
  phone: "",
  email: "",
  document: "",
  customer_type: "retail",
  zip_code: "",
  address: "",
  neighborhood: "",
  city: "",
  reference_point: "",
  notes: "",
};

const schema = z.object({
  name: z.string().trim().min(2, { message: "Informe o nome do cliente" }).max(120),
  phone: z.string().trim().max(30),
  email: z.union([z.string().trim().email({ message: "E-mail inválido" }).max(255), z.literal("")]),
  document: z.string().trim().max(30),
  customer_type: z.enum(["retail", "wholesale"]),
  zip_code: z.string().trim().max(12),
  address: z.string().trim().max(200),
  neighborhood: z.string().trim().max(80),
  city: z.string().trim().max(80),
  reference_point: z.string().trim().max(200),
  notes: z.string().trim().max(500),
});

function CustomersPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [cepBusy, setCepBusy] = useState(false);

  // ViaCEP: serviço público, sem chave. preenche rua, bairro e cidade;
  // o número fica com a pessoa, porque CEP não sabe número.
  const buscarCep = async (raw: string) => {
    const cep = raw.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setCepBusy(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (data.erro) {
        toast.error("CEP não encontrado");
        return;
      }
      setForm((f) => ({
        ...f,
        // o "|| f.x" evita apagar o que já estava quando o CEP volta incompleto
        address: data.logradouro || f.address,
        neighborhood: data.bairro || f.neighborhood,
        city: data.localidade ? `${data.localidade}${data.uf ? ` - ${data.uf}` : ""}` : f.city,
      }));
      toast.success("Endereço preenchido. Falta o número.");
    } catch {
      toast.error("Não foi possível consultar o CEP agora");
    } finally {
      setCepBusy(false);
    }
  };

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async (input: Form) => {
      const parsed = schema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      const payload = {
        name: parsed.data.name,
        phone: parsed.data.phone || null,
        email: parsed.data.email || null,
        document: parsed.data.document || null,
        customer_type: parsed.data.customer_type,
        zip_code: parsed.data.zip_code || null,
        address: parsed.data.address || null,
        neighborhood: parsed.data.neighborhood || null,
        city: parsed.data.city || null,
        reference_point: parsed.data.reference_point || null,
        notes: parsed.data.notes || null,
      };
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
      setForm(empty);
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
            <Button onClick={() => setForm(empty)}>
              <Plus className="mr-2 size-4" /> Novo cliente
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{form.id ? "Editar cliente" : "Novo cliente"}</DialogTitle>
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
                  onValueChange={(v) =>
                    setForm({ ...form, customer_type: v as "retail" | "wholesale" })
                  }
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
              <div className="space-y-1.5">
                <Label>Documento</Label>
                <Input
                  value={form.document}
                  onChange={(e) => setForm({ ...form, document: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>

            <div className="mt-1 border-t border-border pt-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Entrega
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>CEP</Label>
                  <div className="relative">
                    <Input
                      inputMode="numeric"
                      placeholder="00000-000"
                      value={form.zip_code}
                      onChange={(e) => {
                        const v = e.target.value;
                        setForm({ ...form, zip_code: v });
                        // dispara sozinho ao completar os 8 dígitos
                        if (v.replace(/\D/g, "").length === 8) buscarCep(v);
                      }}
                      onBlur={(e) => buscarCep(e.target.value)}
                    />
                    {cepBusy && (
                      <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Cidade</Label>
                  <Input
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Endereço</Label>
                  <Input
                    placeholder="Preenchido pelo CEP — complete com o número"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Bairro</Label>
                  <Input
                    value={form.neighborhood}
                    onChange={(e) => setForm({ ...form, neighborhood: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    É o bairro que define a taxa do entregador.
                  </p>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Ponto de referência</Label>
                  <Input
                    placeholder="Portão azul, ao lado da padaria"
                    value={form.reference_point}
                    onChange={(e) => setForm({ ...form, reference_point: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Observações</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
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
