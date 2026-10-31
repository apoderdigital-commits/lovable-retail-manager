import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// O gasto de tráfego só existe em ad_insights depois que a edge function
// meta-ads-sync roda. Ela só rodava no botão do Marketing, então Financeiro
// e Marketing ficavam zerados nos dias em que ninguém clicava. Este hook
// dispara a sincronização sozinho ao abrir a tela quando o último dado tem
// mais de STALE_MS, com a sessão de quem está logado (a função exige equipe).
const STALE_MS = 6 * 60 * 60 * 1000;

export function useMetaSync({ enabled, days = 30 }: { enabled: boolean; days?: number }) {
  const qc = useQueryClient();
  const attempted = useRef(false);

  const { data: lastSync } = useQuery({
    queryKey: ["meta-last-sync"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_insights")
        .select("synced_at")
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data?.synced_at as string | undefined) ?? null;
    },
  });

  const { data: trackedCount = 0 } = useQuery({
    queryKey: ["meta-tracked-count"],
    enabled,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("ad_campaigns")
        .select("id", { count: "exact", head: true })
        .eq("tracked", true);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const sync = useMutation({
    mutationFn: async (opts: { silent?: boolean } = {}) => {
      const { data, error } = await supabase.functions.invoke("meta-ads-sync", {
        body: { days },
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
        throw Object.assign(new Error(detail), { silent: !!opts.silent });
      }
      return { ...(data as { campaigns: number; days: number }), silent: !!opts.silent };
    },
    onSuccess: (r) => {
      if (!r.silent) toast.success(`${r.campaigns} campanha(s) sincronizada(s)`);
      qc.invalidateQueries({ queryKey: ["meta-last-sync"] });
      qc.invalidateQueries({ queryKey: ["ad-campaigns"] });
      qc.invalidateQueries({ queryKey: ["marketing"] });
      qc.invalidateQueries({ queryKey: ["finance"] });
    },
    // sincronização automática falha em silêncio (ex.: token do Meta não
    // configurado); a manual, pelo botão, mostra o motivo
    onError: (e: Error & { silent?: boolean }) => {
      if (!e.silent) toast.error(e.message);
    },
  });

  const stale =
    lastSync === undefined
      ? false
      : lastSync === null || Date.now() - new Date(lastSync).getTime() > STALE_MS;

  useEffect(() => {
    if (enabled && stale && !attempted.current && !sync.isPending) {
      attempted.current = true;
      sync.mutate({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, stale]);

  return { lastSync: lastSync ?? null, trackedCount, sync, stale };
}
