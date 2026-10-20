import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Logo } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Vieira Perfumes" },
      { name: "description", content: "Acesse o painel de gestão da sua loja no Vieira Perfumes." },
      { property: "og:title", content: "Entrar — Vieira Perfumes" },
      {
        property: "og:description",
        content: "Acesse o painel de gestão da sua loja no Vieira Perfumes.",
      },
    ],
  }),
  component: AuthPage,
});

const schema = z.object({
  email: z.string().trim().email({ message: "E-mail inválido" }).max(255),
  password: z.string().min(6, { message: "A senha precisa de ao menos 6 caracteres" }).max(72),
});

// sem cadastro aberto: acesso novo só é criado por um admin, na tela Usuários
function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [loading, user, navigate]);

  const submit = async () => {
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (error) throw error;
      navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível continuar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2.5">
          <Logo size="size-12" />
          <span className="font-display text-lg font-semibold">Vieira Perfumes</span>
        </div>
        <div className="max-w-sm">
          <h2 className="font-display text-3xl font-semibold leading-tight">
            Estoque, vendas e clientes no mesmo lugar.
          </h2>
          <p className="mt-3 text-sm text-sidebar-foreground/70">
            Registre vendas em segundos, acompanhe o estoque em tempo real e saiba exatamente quanto
            sua loja fatura.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">
          Novos acessos são criados pelo administrador da loja.
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <form
          className="w-full max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h1 className="font-display text-2xl font-semibold">Acesso à loja</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Entre com sua conta. Sem acesso? Peça ao administrador da loja.
          </p>

          <div className="mt-6 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              Entrar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
