import { forwardRef } from "react";
import { brl } from "@/lib/format";

export type CourierStatementData = {
  courierId: string;
  name: string;
  delivered: number;
  notDelivered: number;
  fee: number;
  payments: { method: string; transactions: number; amount: number }[];
  apurado: number;
};

const dateBr = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");

/**
 * Um cartão de extrato por motoboy, impresso em sequência (impressora
 * térmica corta/alimenta entre um e outro). Mesmo conteúdo do card "Por
 * motoboy" do Dashboard de entregas, só que em papel.
 */
export const CourierStatementPrint = forwardRef<
  HTMLDivElement,
  { couriers: CourierStatementData[]; from: string; to: string }
>(({ couriers, from, to }, ref) => {
  const period = from === to ? dateBr(from) : `${dateBr(from)} a ${dateBr(to)}`;

  return (
    <div ref={ref}>
      {couriers.map((c, idx) => (
        <div
          key={c.courierId}
          className="mx-auto w-[300px] bg-white p-4 font-mono text-[12px] leading-tight text-black"
          style={{ pageBreakAfter: idx < couriers.length - 1 ? "always" : "auto" }}
        >
          <div className="text-center">
            <p className="text-sm font-bold">VIEIRA PERFUMES</p>
            <p className="mt-0.5">Extrato do motoboy</p>
          </div>

          <div className="my-2 border-t border-dashed border-black" />

          <div className="flex justify-between gap-2">
            <span>Motoboy</span>
            <span className="truncate text-right">{c.name}</span>
          </div>
          <div className="flex justify-between">
            <span>Período</span>
            <span>{period}</span>
          </div>

          <div className="my-2 border-t border-dashed border-black" />

          <div className="flex justify-between">
            <span>Entregues</span>
            <span>{c.delivered}</span>
          </div>
          <div className="flex justify-between">
            <span>Não entregues</span>
            <span>{c.notDelivered}</span>
          </div>
          <div className="flex justify-between">
            <span>Taxa a receber</span>
            <span>{brl(c.fee)}</span>
          </div>

          <div className="my-2 border-t border-dashed border-black" />

          {c.payments.map((p) => (
            <div key={p.method} className="flex justify-between">
              <span className="capitalize">
                {p.method} · {p.transactions}x
              </span>
              <span>{brl(p.amount)}</span>
            </div>
          ))}
          {c.payments.length === 0 && <p className="text-center">Sem entregas no período.</p>}

          <div className="my-2 border-t border-dashed border-black" />

          <div className="flex justify-between text-sm font-bold">
            <span>Apurado</span>
            <span>{brl(c.apurado)}</span>
          </div>
        </div>
      ))}
    </div>
  );
});
CourierStatementPrint.displayName = "CourierStatementPrint";
