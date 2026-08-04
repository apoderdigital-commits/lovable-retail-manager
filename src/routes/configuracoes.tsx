import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { KeyRound, RefreshCw, Lock, Check, Link2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Vieira Perfumes" },
      { name: "description", content: "Integração com o Meta Ads e vínculo entre ofertas e campanhas." },
    ],
  }),
  component: SettingsPage,
});

type Status = {
  configured: boolean;
  ad_account_id?: string | null;
  token_tail?: string | null;
  updated_at?: string | null;
};

function SettingsPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [account, setAccount] = useState("");
  const [token, setToken] = useState("");

  const { data: status } = useQuery({
    queryKey: ["meta-status"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("meta_settings_status");
      if (error) throw error;
      return data as Status;
    },
  });

  const { data: offers = [] } = useQuery({
    queryKey: ["offers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("offers").select("*").order("item_count");
      if (error) throw error;
      return data;
    },
  });

  const { data: campaigns = [] } = useQuery({
    queryKey: ["ad-campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ad_campaigns").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: links = [] } = useQuery({
    queryKey: ["offer-campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase.from("offer_campaigns").select("*");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!token.trim() && !status?.configured) throw new Error("Cole o token");
      const payload: Record<string, unknown> = {
        id: "meta_ads",
        ad_account_id: account.trim() || status?.ad_account_id,
        updated_at: new Date().toISOString(),
      };
      // token em branco quando já existe = manter o atual
      if (token.trim()) payload.access_token = token.trim();

      const { error } = await supabase
        .from("integration_settings")
        .upsert(payload, { onConflict: "id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Credenciais salvas");
      setToken("");
      qc.invalidateQueries({ queryKey: ["meta-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("meta-ads-sync", {
        body: { days: 30 },
      });
      if (error) {
        let detail = error.message;
        const res = (error as { context?: Response }).context;
        if (res?.json) {
          try {
            const body = await res.json();
            if (body?.error) detail = body.error;
          } catch {
            // corpo não era JSON
          }
        }
        throw new Error(detail);
      }
      return data as { campaigns: number; days: number };
    },
    onSuccess: (r) => {
      toast.success(`${r.campaigns} campanha(s) sincronizada(s)`);
      qc.invalidateQueries({ queryKey: ["ad-campaigns"] });
      qc.invalidateQueries({ queryKey: ["marketing"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleLink = useMutation({
    mutationFn: async ({
      offerId,
      campaignId,
      on,
    }: {
      offerId: string;
      campaignId: string;
      on: boolean;
    }) => {
      if (on) {
        const { error } = await supabase
          .from("offer_campaigns")
          .insert({ offer_id: offerId, campaign_id: campaignId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("offer_campaigns")
          .delete()
          .eq("offer_id", offerId)
          .eq("campaign_id", campaignId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offer-campaigns"] });
      qc.invalidateQueries({ queryKey: ["marketing"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) {
    return (
      <AppShell title="Configurações">
        <div className="panel p-8 text-center">
          <Lock className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Área restrita</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Só administradores alteram as integrações.
          </p>
        </div>
      </AppShell>
    );
  }

  const linkedTo = (offerId: string) =>
    links.filter((l) => l.offer_id === offerId).map((l) => l.campaign_id);

  return (
    <AppShell title="Configurações" subtitle="Integrações e vínculos">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Meta Ads</h2>
            {status?.configured && (
              <Badge className="ml-auto border-transparent bg-success text-success-foreground">
                <Check className="mr-1 size-3" /> Conectado
              </Badge>
            )}
          </div>

          {status?.configured && (
            <p className="mb-3 text-xs text-muted-foreground">
              Token terminado em <code className="rounded bg-muted px-1">{status.token_tail}</code>
              {status.updated_at &&
                ` · atualizado em ${new Date(status.updated_at).toLocaleDateString("pt-BR")}`}
            </p>
          )}

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>ID da conta de anúncios</Label>
              <Input
                placeholder={status?.ad_account_id ?? "act_1234567890"}
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Token de acesso</Label>
              <Input
                type="password"
                placeholder={status?.configured ? "deixe vazio para manter o atual" : "cole aqui"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                O token entra e não sai: nem esta tela consegue lê-lo depois de salvo. Para trocar,
                cole um novo. Use token de usuário de sistema com permissão <code>ads_read</code>,
                que não expira.
              </p>
            </div>

            <div className="flex gap-2">
              <Button disabled={save.isPending} onClick={() => save.mutate()}>
                Salvar
              </Button>
              <Button
                variant="outline"
                disabled={!status?.configured || sync.isPending}
                onClick={() => sync.mutate()}
              >
                <RefreshCw className={`mr-2 size-4 ${sync.isPending ? "animate-spin" : ""}`} />
                Sincronizar 30 dias
              </Button>
            </div>
          </div>
        </section>

        <section className="panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <Link2 className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Ofertas e campanhas</h2>
          </div>

          {campaigns.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma campanha ainda. Salve as credenciais e sincronize para trazer a lista do Meta.
            </p>
          ) : (
            <div className="space-y-4">
              {offers.map((o) => {
                const linked = linkedTo(o.id);
                return (
                  <div key={o.id}>
                    <p className="mb-1.5 text-sm font-medium">{o.name}</p>
                    <div className="space-y-1">
                      {campaigns.map((c) => {
                        const on = linked.includes(c.id);
                        return (
                          <label
                            key={c.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                toggleLink.mutate({
                                  offerId: o.id,
                                  campaignId: c.id,
                                  on: !on,
                                })
                              }
                            />
                            <span className="min-w-0 flex-1 truncate">{c.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">
                O gasto de cada campanha marcada entra no resultado daquela oferta. Campanha sem
                vínculo não aparece em Marketing.
              </p>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
