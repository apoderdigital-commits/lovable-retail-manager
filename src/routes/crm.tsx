import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Clock, Copy, History, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { brl, dateShort } from "@/lib/format";

export const Route = createFileRoute("/crm")({
  head: () => ({
    meta: [
      { title: "CRM — Vieira Perfumes" },
      {
        name: "description",
        content: "Clientes de varejo prontos para follow-up de recompra.",
      },
    ],
  }),
  component: CrmPage,
});

/** types.ts ainda não conhece as tabelas/colunas novas do CRM. */
const db = supabase as unknown as SupabaseClient;

type Offer = { id: string; name: string; repurchase_days: number };
type SaleRow = {
  id: string;
  sale_number: number;
  offer_id: string | null;
  total: number;
  created_at: string;
  customer_id: string | null;
  customers: { id: string; name: string; phone: string | null; customer_type: string } | null;
};
type Followup = { id: number; customer_id: string; created_at: string };

type CardData = {
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  offer: Offer;
  sale: SaleRow;
  diasDesde: number;
  lastFollowupAt: string | null;
};

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function renderMessage(template: string, customerName: string, offerName: string) {
  return template.replaceAll("{{cliente}}", customerName).replaceAll("{{oferta}}", offerName);
}

function CrmPage() {
  const qc = useQueryClient();
  const [historyCustomer, setHistoryCustomer] = useState<CardData | null>(null);
  const [followupCard, setFollowupCard] = useState<CardData | null>(null);
  const [messageDraft, setMessageDraft] = useState("");

  const { data: offers = [] } = useQuery({
    queryKey: ["crm-offers"],
    queryFn: async () => {
      const { data, error } = await db
        .from("offers")
        .select("id, name, repurchase_days")
        .not("repurchase_days", "is", null);
      if (error) throw error;
      return data as Offer[];
    },
  });

  const offerIds = useMemo(() => offers.map((o) => o.id), [offers]);

  const { data: sales = [], isLoading } = useQuery({
    queryKey: ["crm-sales", offerIds],
    enabled: offerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("sales")
        .select("id, sale_number, offer_id, total, created_at, customer_id, customers(id, name, phone, customer_type)")
        .in("offer_id", offerIds)
        .neq("status", "cancelled")
        .not("customer_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as SaleRow[];
    },
  });

  // histórico completo por cliente, pra abrir no "Ver histórico"
  const customerIds = useMemo(
    () => Array.from(new Set(sales.map((s) => s.customer_id).filter((id): id is string => !!id))),
    [sales],
  );

  const { data: allSalesByCustomer = [] } = useQuery({
    queryKey: ["crm-customer-history", customerIds],
    enabled: customerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("sales")
        .select("id, sale_number, offer_id, total, created_at, customer_id")
        .in("customer_id", customerIds)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as { id: string; sale_number: number; offer_id: string | null; total: number; created_at: string; customer_id: string }[];
    },
  });

  const { data: followups = [] } = useQuery({
    queryKey: ["crm-followups", customerIds],
    enabled: customerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("crm_followups")
        .select("id, customer_id, created_at")
        .in("customer_id", customerIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Followup[];
    },
  });

  const { data: followupMessage = "" } = useQuery({
    queryKey: ["crm-followup-message"],
    queryFn: async () => {
      const { data, error } = await db.rpc("crm_followup_message");
      if (error) throw error;
      return (data as string | null) ?? "";
    },
  });

  const markSent = useMutation({
    mutationFn: async (input: { customerId: string; saleId: string; offerId: string; message: string }) => {
      const { data: auth } = await db.auth.getUser();
      const { error } = await db.from("crm_followups").insert({
        customer_id: input.customerId,
        sale_id: input.saleId,
        offer_id: input.offerId,
        message: input.message,
        sent_by: auth.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Follow-up registrado");
      setFollowupCard(null);
      qc.invalidateQueries({ queryKey: ["crm-followups"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const offerById = useMemo(() => new Map(offers.map((o) => [o.id, o])), [offers]);

  const { aguardando, followup } = useMemo(() => {
    const offerByIdLocal = offerById;
    const seen = new Set<string>();
    const lastFollowupByCustomer = new Map<string, string>();
    for (const f of followups) {
      if (!lastFollowupByCustomer.has(f.customer_id)) lastFollowupByCustomer.set(f.customer_id, f.created_at);
    }

    const aguardandoList: CardData[] = [];
    const followupList: CardData[] = [];

    for (const sale of sales) {
      const customerId = sale.customer_id;
      if (!customerId || seen.has(customerId)) continue;
      if (sale.customers?.customer_type !== "retail") continue;
      const offer = sale.offer_id ? offerByIdLocal.get(sale.offer_id) : undefined;
      if (!offer) continue;
      seen.add(customerId);

      const diasDesde = daysSince(sale.created_at);
      const lastFollowupAt = lastFollowupByCustomer.get(customerId) ?? null;

      const card: CardData = {
        customerId,
        customerName: sale.customers?.name ?? "—",
        customerPhone: sale.customers?.phone ?? null,
        offer,
        sale,
        diasDesde,
        lastFollowupAt,
      };

      if (diasDesde >= offer.repurchase_days) followupList.push(card);
      else aguardandoList.push(card);
    }

    followupList.sort((a, b) => b.diasDesde - a.diasDesde);
    aguardandoList.sort((a, b) => a.offer.repurchase_days - a.diasDesde - (b.offer.repurchase_days - b.diasDesde));

    return { aguardando: aguardandoList, followup: followupList };
  }, [sales, offerById, followups]);

  const openFollowup = (card: CardData) => {
    setFollowupCard(card);
    setMessageDraft(renderMessage(followupMessage, card.customerName, card.offer.name));
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(messageDraft);
      toast.success("Mensagem copiada");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const historyList = historyCustomer
    ? allSalesByCustomer.filter((s) => s.customer_id === historyCustomer.customerId)
    : [];

  return (
    <AppShell
      title="CRM"
      subtitle={isLoading ? "Carregando..." : `${aguardando.length + followup.length} cliente(s) em acompanhamento`}
    >
      {offers.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="text-sm font-medium">Nenhuma oferta com dias de recompra configurados</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Vá em Configurações → CRM e defina os dias de recompra por oferta.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Column
            title="Aguardando"
            icon={Clock}
            cards={aguardando}
            onHistory={setHistoryCustomer}
            onFollowup={openFollowup}
          />
          <Column
            title="Follow up"
            icon={Send}
            cards={followup}
            highlight
            onHistory={setHistoryCustomer}
            onFollowup={openFollowup}
          />
        </div>
      )}

      <Dialog open={!!historyCustomer} onOpenChange={(v) => !v && setHistoryCustomer(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{historyCustomer?.customerName}</DialogTitle>
          </DialogHeader>
          {historyCustomer?.customerPhone && (
            <p className="text-sm text-muted-foreground">{historyCustomer.customerPhone}</p>
          )}
          <div className="space-y-1.5">
            {historyList.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  #{s.sale_number} · {dateShort(s.created_at)}
                </span>
                <span className="font-medium">{brl(Number(s.total))}</span>
              </div>
            ))}
            {historyList.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Sem outras compras.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!followupCard} onOpenChange={(v) => !v && setFollowupCard(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Follow-up — {followupCard?.customerName}</DialogTitle>
          </DialogHeader>
          {!followupMessage && (
            <p className="text-sm text-warning">
              Nenhuma mensagem configurada ainda em Configurações → CRM. Escreva uma abaixo antes de
              registrar.
            </p>
          )}
          <Textarea rows={6} value={messageDraft} onChange={(e) => setMessageDraft(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            O envio de verdade pelo WhatsApp ainda não está automatizado — copie a mensagem e envie
            manualmente, depois marque como enviado.
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => void copyMessage()}>
              <Copy className="mr-1.5 size-4" /> Copiar mensagem
            </Button>
            <Button
              disabled={markSent.isPending}
              onClick={() =>
                followupCard &&
                markSent.mutate({
                  customerId: followupCard.customerId,
                  saleId: followupCard.sale.id,
                  offerId: followupCard.offer.id,
                  message: messageDraft,
                })
              }
            >
              Marcar como enviado
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Column({
  title,
  icon: Icon,
  cards,
  highlight,
  onHistory,
  onFollowup,
}: {
  title: string;
  icon: typeof Clock;
  cards: CardData[];
  highlight?: boolean;
  onHistory: (c: CardData) => void;
  onFollowup: (c: CardData) => void;
}) {
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Icon className={`size-4 ${highlight ? "text-accent" : "text-muted-foreground"}`} />
        <h2 className="text-sm font-semibold">{title}</h2>
        <Badge variant="secondary" className="ml-auto">
          {cards.length}
        </Badge>
      </header>
      <div className="flex flex-col divide-y divide-border">
        {cards.map((c) => (
          <div key={c.customerId} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.customerName}</p>
                {c.customerPhone && <p className="text-xs text-muted-foreground">{c.customerPhone}</p>}
              </div>
              <Badge variant="outline" className="shrink-0 text-[11px]">
                {c.diasDesde}d desde a compra
              </Badge>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Comprou <span className="font-medium text-foreground">{c.offer.name}</span> em{" "}
              {dateShort(c.sale.created_at)} · recompra em {c.offer.repurchase_days}d
            </p>
            {c.lastFollowupAt && new Date(c.lastFollowupAt) > new Date(c.sale.created_at) && (
              <p className="mt-1 text-xs text-success">
                Follow-up enviado em {dateShort(c.lastFollowupAt)}
              </p>
            )}
            <div className="mt-2.5 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onHistory(c)}>
                <History className="mr-1.5 size-3.5" /> Histórico
              </Button>
              <Button size="sm" onClick={() => onFollowup(c)}>
                <MessageCircle className="mr-1.5 size-3.5" /> Enviar follow up
              </Button>
            </div>
          </div>
        ))}
        {cards.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Ninguém por aqui.</p>
        )}
      </div>
    </section>
  );
}
