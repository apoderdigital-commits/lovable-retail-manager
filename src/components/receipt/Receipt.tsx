import { forwardRef } from "react";
import { brl } from "@/lib/format";

export type ReceiptSale = {
  sale_number: number;
  created_at: string;
  payment_method: string;
  discount: number;
  subtotal: number;
  total: number;
  neighborhood: string | null;
  delivery_address: string | null;
  customer_name: string | null;
};

export type ReceiptItem = {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
};

/**
 * Recibo puro, sem depender do tema (claro/escuro) do app: html2canvas e
 * impressão térmica precisam de preto sobre branco de verdade, não de
 * variáveis CSS que mudam com o sistema de quem está olhando a tela.
 */
export const Receipt = forwardRef<HTMLDivElement, { sale: ReceiptSale; items: ReceiptItem[] }>(
  ({ sale, items }, ref) => {
    return (
      <div
        ref={ref}
        className="mx-auto w-[300px] bg-white p-4 font-mono text-[12px] leading-tight text-black"
      >
        <div className="text-center">
          <p className="text-sm font-bold">VIEIRA PERFUMES</p>
          <p className="mt-0.5">Recibo de venda</p>
        </div>

        <div className="my-2 border-t border-dashed border-black" />

        <div className="flex justify-between">
          <span>Pedido</span>
          <span>#{sale.sale_number}</span>
        </div>
        <div className="flex justify-between">
          <span>Data</span>
          <span>{new Date(sale.created_at).toLocaleString("pt-BR")}</span>
        </div>
        {sale.customer_name && (
          <div className="flex justify-between gap-2">
            <span>Cliente</span>
            <span className="truncate text-right">{sale.customer_name}</span>
          </div>
        )}
        {sale.delivery_address && (
          <div className="mt-1">
            <p>Entrega:</p>
            <p>
              {sale.delivery_address}
              {sale.neighborhood ? ` - ${sale.neighborhood}` : ""}
            </p>
          </div>
        )}

        <div className="my-2 border-t border-dashed border-black" />

        {items.map((i) => (
          <div key={i.id} className="mb-1">
            <div className="flex justify-between">
              <span className="truncate pr-2">{i.product_name}</span>
              <span>{brl(i.total)}</span>
            </div>
            <div className="text-[10px] text-neutral-700">
              {i.quantity} × {brl(i.unit_price)}
            </div>
          </div>
        ))}

        <div className="my-2 border-t border-dashed border-black" />

        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{brl(sale.subtotal)}</span>
        </div>
        {sale.discount > 0 && (
          <div className="flex justify-between">
            <span>Desconto</span>
            <span>-{brl(sale.discount)}</span>
          </div>
        )}
        <div className="mt-1 flex justify-between text-sm font-bold">
          <span>Total</span>
          <span>{brl(sale.total)}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span>Pagamento</span>
          <span className="capitalize">{sale.payment_method}</span>
        </div>

        <div className="my-2 border-t border-dashed border-black" />
        <p className="text-center">Obrigado pela preferência!</p>
      </div>
    );
  },
);
Receipt.displayName = "Receipt";
