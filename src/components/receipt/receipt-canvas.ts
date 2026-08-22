import { brl } from "@/lib/format";

export type ReceiptCanvasSale = {
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

export type ReceiptCanvasItem = {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
};

const SCALE = 2;
const FONT = "monospace";
const LINE_H = 16;
const PAD = 16;

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * Desenha o recibo direto num canvas, sem "fotografar" o DOM (nada de
 * html2canvas). O CSP da hospedagem bloqueia eval/new Function, que é
 * exatamente o que qualquer lib de captura de tela usa por baixo — desenhar
 * na mão com a API nativa do Canvas não esbarra nessa trava.
 */
export function renderReceiptCanvas(
  sale: ReceiptCanvasSale,
  items: ReceiptCanvasItem[],
  widthPx: number,
): HTMLCanvasElement {
  const contentWidth = widthPx - PAD * 2;

  let lines = 3; // título + subtítulo + divisor
  lines += 2; // pedido, data
  if (sale.customer_name) lines += 1;
  if (sale.delivery_address) lines += 2;
  lines += 1; // divisor
  lines += items.length * 2;
  lines += 1; // divisor
  lines += 1; // subtotal
  if (sale.discount > 0) lines += 1;
  lines += 2; // total, pagamento
  lines += 1; // divisor
  lines += 1; // agradecimento

  const height = PAD * 2 + lines * LINE_H;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(widthPx * SCALE);
  canvas.height = Math.round(height * SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthPx, height);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  let y = PAD;
  const left = PAD;
  const right = widthPx - PAD;

  const row = (l: string, r: string, bold = false) => {
    ctx.font = `${bold ? "bold " : ""}12px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(l, left, y);
    ctx.textAlign = "right";
    ctx.fillText(r, right, y);
    y += LINE_H;
  };

  const center = (t: string, bold = false, size = 12) => {
    ctx.font = `${bold ? "bold " : ""}${size}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(t, widthPx / 2, y);
    y += LINE_H;
  };

  const divider = () => {
    ctx.strokeStyle = "#000000";
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(left, y + 6);
    ctx.lineTo(right, y + 6);
    ctx.stroke();
    ctx.setLineDash([]);
    y += LINE_H;
  };

  center("VIEIRA PERFUMES", true, 13);
  center("Recibo de venda");
  divider();

  row("Pedido", `#${sale.sale_number}`);
  row("Data", new Date(sale.created_at).toLocaleString("pt-BR"));
  if (sale.customer_name) {
    ctx.font = `12px ${FONT}`;
    row("Cliente", truncate(ctx, sale.customer_name, contentWidth * 0.55));
  }
  if (sale.delivery_address) {
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText("Entrega:", left, y);
    y += LINE_H;
    const addr = `${sale.delivery_address}${sale.neighborhood ? ` - ${sale.neighborhood}` : ""}`;
    ctx.fillText(truncate(ctx, addr, contentWidth), left, y);
    y += LINE_H;
  }

  divider();

  for (const i of items) {
    ctx.font = `12px ${FONT}`;
    row(truncate(ctx, i.product_name, contentWidth * 0.6), brl(i.total));
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = "#404040";
    ctx.textAlign = "left";
    ctx.fillText(`${i.quantity} × ${brl(i.unit_price)}`, left, y);
    ctx.fillStyle = "#000000";
    y += LINE_H;
  }

  divider();

  row("Subtotal", brl(sale.subtotal));
  if (sale.discount > 0) row("Desconto", `-${brl(sale.discount)}`);
  row("Total", brl(sale.total), true);
  row("Pagamento", sale.payment_method);

  divider();
  center("Obrigado pela preferência!");

  return canvas;
}
