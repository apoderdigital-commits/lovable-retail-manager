import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
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

export type CustomerFormValues = {
  id?: string;
  name: string;
  phone: string;
  email: string;
  document: string;
  birth_date: string;
  customer_type: "retail" | "wholesale";
  zip_code: string;
  address: string;
  neighborhood: string;
  city: string;
  reference_point: string;
  notes: string;
};

export const emptyCustomerForm: CustomerFormValues = {
  name: "",
  phone: "",
  email: "",
  document: "",
  birth_date: "",
  customer_type: "retail",
  zip_code: "",
  address: "",
  neighborhood: "",
  city: "",
  reference_point: "",
  notes: "",
};

export const customerSchema = z.object({
  name: z.string().trim().min(2, { message: "Informe o nome do cliente" }).max(120),
  phone: z.string().trim().max(30),
  email: z.union([z.string().trim().email({ message: "E-mail inválido" }).max(255), z.literal("")]),
  document: z.string().trim().max(30),
  birth_date: z.union([z.string().trim().date(), z.literal("")]),
  customer_type: z.enum(["retail", "wholesale"]),
  zip_code: z.string().trim().max(12),
  address: z.string().trim().max(200),
  neighborhood: z.string().trim().max(80),
  city: z.string().trim().max(80),
  reference_point: z.string().trim().max(200),
  notes: z.string().trim().max(500),
});

/** Valida e monta o payload pronto pro insert/update em `customers`. */
export function customerPayload(input: CustomerFormValues) {
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Dados inválidos");
  return {
    name: parsed.data.name,
    phone: parsed.data.phone || null,
    email: parsed.data.email || null,
    document: parsed.data.document || null,
    birth_date: parsed.data.birth_date || null,
    customer_type: parsed.data.customer_type,
    zip_code: parsed.data.zip_code || null,
    address: parsed.data.address || null,
    neighborhood: parsed.data.neighborhood || null,
    city: parsed.data.city || null,
    reference_point: parsed.data.reference_point || null,
    notes: parsed.data.notes || null,
  };
}

/**
 * Formulário completo de cliente — usado tanto em /clientes quanto no
 * cadastro rápido do PDV. É o mesmo cadastro nos dois lugares: quem chega
 * pela primeira vez no balcão merece o endereço completo, não um cadastro
 * pela metade que alguém vai ter que voltar e terminar depois.
 */
export function CustomerFormFields({
  form,
  onChange,
}: {
  form: CustomerFormValues;
  onChange: (form: CustomerFormValues) => void;
}) {
  const [cepBusy, setCepBusy] = useState(false);
  const set = <K extends keyof CustomerFormValues>(key: K, value: CustomerFormValues[K]) =>
    onChange({ ...form, [key]: value });

  // ViaCEP: serviço público, sem chave. preenche rua, bairro e cidade; o
  // número fica com a pessoa, porque CEP não sabe número.
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
      onChange({
        ...form,
        address: data.logradouro || form.address,
        neighborhood: data.bairro || form.neighborhood,
        city: data.localidade ? `${data.localidade}${data.uf ? ` - ${data.uf}` : ""}` : form.city,
      });
      toast.success("Endereço preenchido. Falta o número.");
    } catch {
      toast.error("Não foi possível consultar o CEP agora");
    } finally {
      setCepBusy(false);
    }
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Nome</Label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Telefone / WhatsApp</Label>
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <Select
            value={form.customer_type}
            onValueChange={(v) => set("customer_type", v as "retail" | "wholesale")}
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
          <Input value={form.document} onChange={(e) => set("document", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>E-mail</Label>
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Aniversário</Label>
          <Input
            type="date"
            value={form.birth_date}
            onChange={(e) => set("birth_date", e.target.value)}
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
                  set("zip_code", v);
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
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Endereço</Label>
            <Input
              placeholder="Preenchido pelo CEP — complete com o número"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Bairro</Label>
            <Input
              value={form.neighborhood}
              onChange={(e) => set("neighborhood", e.target.value)}
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
              onChange={(e) => set("reference_point", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Observações</Label>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
    </>
  );
}
