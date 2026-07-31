import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Varejo360" },
      { name: "description", content: "Acesse o painel de gestão da sua loja no Varejo360." },
      { property: "og:title", content: "Entrar — Varejo360" },
      {
        property: "og:description",
        content: "Acesse o painel de gestão da sua loja no Varejo360.",
      },
    ],
  }),
  component: AuthPage,
});

const schema = z.object({
  email: z.string().trim().email({ message: "E-mail inválido" }).max(255),
  password: z.string().min(6, { message: "A senha precisa de ao menos 6 caracteres" }).max(72),
  fullName: z.string().trim().max(100).optional(),
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [loading, user, navigate]);

  const submit = async (mode: "login" | "signup") => {
    const parsed = schema.safeParse({ email, password, fullName });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) throw error;
        navigate({ to: "/" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: parsed.data.fullName || null },
          },
        });
        if (error) throw error;
        if (!data.session) {
          setSent(true);
          toast.success("Confirme seu e-mail para ativar a conta.");
        } else {
          navigate({ to: "/" });
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível continuar");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Não foi possível entrar com o Google");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/" });
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Store className="size-5" />
          </span>
          <span className="font-display text-lg font-semibold">Varejo360</span>
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
          O primeiro cadastro da loja recebe acesso de administrador.
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-2xl font-semibold">Acesso à loja</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Entre com sua conta ou crie um novo acesso.
          </p>

          {sent ? (
            <div className="panel mt-6 p-4 text-sm">
              Enviamos um link de confirmação para <strong>{email}</strong>. Confirme para entrar.
            </div>
          ) : (
            <Tabs defaultValue="login" className="mt-6">
              <TabsList className="w-full">
                <TabsTrigger value="login" className="flex-1">
                  Entrar
                </TabsTrigger>
                <TabsTrigger value="signup" className="flex-1">
                  Criar conta
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Senha</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button className="w-full" disabled={busy} onClick={() => submit("login")}>
                  Entrar
                </Button>
              </TabsContent>

              <TabsContent value="signup" className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email2">E-mail</Label>
                  <Input
                    id="email2"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password2">Senha</Label>
                  <Input
                    id="password2"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button className="w-full" disabled={busy} onClick={() => submit("signup")}>
                  Criar conta
                </Button>
              </TabsContent>
            </Tabs>
          )}

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
          </div>
          <Button variant="outline" className="w-full" onClick={google}>
            Continuar com Google
          </Button>
        </div>
      </div>
    </div>
  );
}
