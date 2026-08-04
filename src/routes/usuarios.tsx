import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { UserPlus, ShieldOff, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth, ROLE_LABEL } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Database } from "@/integrations/supabase/types";

type Role = Database["public"]["Enums"]["app_role"];

// papéis oferecidos hoje. 'attendant' existe no enum por acidente
// histórico e não é oferecido: vendedor cobre o mesmo caso.
const ROLES: { value: Role; hint: string }[] = [
  { value: "admin", hint: "Acesso total, inclusive a esta tela" },
  { value: "vendedor", hint: "Vendas, pedidos, clientes e despacho" },
  { value: "stockist", hint: "Produtos e estoque" },
  { value: "courier", hint: "Só a própria rota de entrega" },
];

export const Route = createFileRoute("/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários — Vieira Perfumes" },
      { name: "description", content: "Crie acessos e defina o papel de cada pessoa da equipe." },
    ],
  }),
  component: UsersPage,
});

function UsersPage() {
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "vendedor" as Role,
  });

  const { data: people = [], isLoading } = useQuery({
    queryKey: ["users"],
    enabled: isAdmin,
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, created_at"),
        supabase.from("user_roles").select("id, user_id, role"),
      ]);
      return (profiles ?? [])
        .map((p) => ({
          ...p,
          roles: (roles ?? []).filter((r) => r.user_id === p.id),
        }))
        .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: form,
      });

      // quando a função responde com status de erro, o supabase-js entrega
      // só "non-2xx status code" e guarda o corpo em error.context. sem ler
      // dali, a mensagem real do servidor nunca chega na tela.
      if (error) {
        let detail = error.message;
        const res = (error as { context?: Response }).context;
        if (res && typeof res.json === "function") {
          try {
            const body = await res.json();
            if (body?.error) detail = body.error;
          } catch {
            // corpo não era JSON: fica a mensagem genérica mesmo
          }
        }
        throw new Error(detail);
      }

      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data;
    },
    onSuccess: () => {
      toast.success("Acesso criado");
      setOpen(false);
      setForm({ full_name: "", email: "", password: "", role: "vendedor" });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: Role }) => {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Papel atualizado");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Acesso revogado");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) {
    return (
      <AppShell title="Usuários">
        <div className="panel p-8 text-center">
          <Lock className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Área restrita</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Só administradores criam e alteram acessos.
          </p>
        </div>
      </AppShell>
    );
  }

  const admins = people.filter((p) => p.roles.some((r) => r.role === "admin")).length;

  // mesmas regras da Edge Function, para o erro aparecer antes do envio
  const valid =
    form.full_name.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(form.email.trim()) &&
    form.password.length >= 8;

  return (
    <AppShell
      title="Usuários"
      subtitle={isLoading ? "Carregando..." : `${people.length} conta(s)`}
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="mr-2 size-4" /> Novo acesso
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo acesso</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>E-mail</Label>
                <Input
                  type="email"
                  placeholder="nome@dominio.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Senha inicial</Label>
                <Input
                  type="text"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="mínimo 8 caracteres"
                />
                <p className="text-xs text-muted-foreground">
                  Entregue a senha à pessoa e peça que troque no primeiro acesso.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Papel</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm({ ...form, role: v as Role })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {ROLE_LABEL[r.value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {ROLES.find((r) => r.value === form.role)?.hint}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={create.isPending || !valid}
                onClick={() => create.mutate()}
              >
                Criar acesso
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="panel overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pessoa</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((p) => {
              const current = p.roles[0]?.role ?? null;
              const isSelf = p.id === user?.id;
              const lastAdmin = current === "admin" && admins <= 1;

              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <p className="font-medium">{p.full_name || "sem nome"}</p>
                    <p className="text-xs text-muted-foreground">{p.email}</p>
                  </TableCell>
                  <TableCell>
                    {current ? (
                      <Select
                        value={current}
                        disabled={isSelf || lastAdmin || setRole.isPending}
                        onValueChange={(v) => setRole.mutate({ userId: p.id, role: v as Role })}
                      >
                        <SelectTrigger className="h-8 w-44 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {ROLE_LABEL[r.value]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary">Sem acesso</Badge>
                    )}
                    {isSelf && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Você não altera o próprio papel
                      </p>
                    )}
                    {lastAdmin && !isSelf && (
                      <p className="mt-1 text-xs text-muted-foreground">Único administrador</p>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {current && !isSelf && !lastAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => revoke.mutate(p.id)}
                        disabled={revoke.isPending}
                      >
                        <ShieldOff className="mr-1.5 size-3.5 text-destructive" /> Revogar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {people.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                  Nenhuma conta ainda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Revogar tira todo o acesso, mas não apaga a conta nem o histórico do que a pessoa fez.
      </p>
    </AppShell>
  );
}
