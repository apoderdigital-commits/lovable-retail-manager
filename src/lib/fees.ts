// Taxa da maquininha. Mesma regra do banco (apply_payment_fees): débito e
// crédito são somados em cima do valor e cobrados do cliente; pix fica por
// conta da loja e não aparece pro cliente. As porcentagens vêm da tabela
// payment_fees, editável em Configurações.

export type FeeRow = { method: string; installments: number; rate_pct: number };

export const INSTALLMENTS = Array.from({ length: 18 }, (_, i) => i + 1);

export const isCard = (method: string) => method === "débito" || method === "crédito";

export function feePct(fees: FeeRow[], method: string, installments = 1) {
  const n = method === "crédito" ? Math.max(1, installments) : 1;
  return Number(fees.find((f) => f.method === method && f.installments === n)?.rate_pct ?? 0);
}

/** taxa cobrada do cliente nessa forma (0 pra dinheiro, pix e boleto) */
export function surchargeFor(fees: FeeRow[], method: string, installments: number, base: number) {
  if (!isCard(method) || base <= 0) return 0;
  return Math.round(base * feePct(fees, method, installments)) / 100;
}

/** "crédito 5x" / "débito" / "pix" — como aparece em recibo e ficha */
export function methodWithInstallments(method: string, installments: number) {
  return method === "crédito" && installments > 1 ? `${method} ${installments}x` : method;
}
