// Prévia dos kits de oferta no carrinho — a MESMA regra do create_order no
// banco (migration 20261021010000_partial_offers), que é quem cobra de
// verdade. Mudou lá, muda aqui.
//
//   . da maior oferta pra menor, junta as unidades elegíveis mais baratas
//     em kits (10 da linha → 1 kit, 20 → 2 kits, 14 → 10 + 4)
//   . oferta com categorias só aceita produtos dessas categorias; sem
//     categoria, o kit só junta produtos do mesmo preço (a mesma linha)
//   . só fecha o kit se não sair mais caro que o preço normal das unidades
//   . o que sobra é cobrado pelo preço da tabela do cliente

export type OfferRule = {
  id: string;
  name: string;
  item_count: number;
  price: number;
  category_ids?: string[] | null;
};

export type CartLine = { productId: string; quantity: number; unit: number; categoryId: string | null };

export type AppliedOffer = { offer: OfferRule; bundles: number; regular: number; charged: number };

export function applyOffers(lines: CartLine[], offers: OfferRule[]) {
  type Unit = { seq: number; regular: number; category: string | null; offerId: string | null };
  const units: Unit[] = [];
  let seq = 0;
  for (const l of lines) {
    for (let i = 0; i < l.quantity; i++) {
      units.push({ seq: seq++, regular: l.unit, category: l.categoryId, offerId: null });
    }
  }

  const applied: AppliedOffer[] = [];
  const sorted = [...offers].sort(
    (a, b) => b.item_count - a.item_count || Number(a.price) - Number(b.price),
  );

  for (const o of sorted) {
    const cats = o.category_ids ?? [];
    const eligible = units
      .filter((u) => !u.offerId && (cats.length === 0 || (u.category && cats.includes(u.category))))
      .sort((a, b) => a.regular - b.regular || a.seq - b.seq);
    // sem categoria configurada, o kit só junta produtos do MESMO preço (a
    // mesma linha): 9 de R$ 25 + 1 de R$ 150 não vira "10 por R$ 200"
    const groups =
      cats.length > 0
        ? [eligible]
        : [...new Set(eligible.map((u) => u.regular))].map((p) =>
            eligible.filter((u) => u.regular === p),
          );
    for (const group of groups) {
      const bundles = Math.floor(group.length / o.item_count);
      if (bundles === 0) continue;
      const take = group.slice(0, bundles * o.item_count);
      const regular = take.reduce((s, u) => s + u.regular, 0);
      const charged = bundles * Number(o.price);
      // kit igual ao preço normal (4 de R$ 25 = "4 por R$ 100") ainda conta
      // como oferta, pro Marketing; só não fecha se sair mais caro
      if (regular < charged) continue;
      for (const u of take) u.offerId = o.id;
      const prev = applied.find((a) => a.offer.id === o.id);
      if (prev) {
        prev.bundles += bundles;
        prev.regular += regular;
        prev.charged += charged;
      } else {
        applied.push({ offer: o, bundles, regular, charged });
      }
    }
  }

  const subtotal = units.reduce((s, u) => s + u.regular, 0);
  const discount = applied.reduce((s, a) => s + (a.regular - a.charged), 0);
  return { applied, subtotal, discount, total: subtotal - discount };
}
