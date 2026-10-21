export const brl = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);

// A loja é em Recife: datas e horas são SEMPRE mostradas e filtradas nesse
// fuso, não no do aparelho nem em UTC. Sem isso uma venda das 21h17 aparecia
// como 00h17 do dia seguinte e caía no "Hoje" errado.
// Recife não tem horário de verão, então o deslocamento é fixo em -03:00.
export const TZ = "America/Recife";
const OFFSET = "-03:00";

export const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: TZ }).format(
    new Date(iso),
  );

export const dateShort = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TZ }).format(
    new Date(iso),
  );

/** dd/mm/aaaa de um instante (created_at etc.) */
export const dateBr = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TZ }).format(new Date(iso));

/** dd/mm/aaaa hh:mm:ss de um instante */
export const dateTimeFull = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: TZ });

/** hh:mm de um instante */
export const timeShort = (iso: string | number | Date) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

/** dd/mm/aaaa de uma data pura "aaaa-mm-dd" (sem hora, não muda de dia) */
export const dayBr = (day: string) => {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
};

/** "aaaa-mm-dd" do dia de hoje (ou de um instante) em Recife */
export const todayISO = (at: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(at);

/** primeiro dia do mês corrente em Recife, "aaaa-mm-01" */
export const monthStartISO = () => `${todayISO().slice(0, 8)}01`;

/** limites de um dia de Recife pra filtrar created_at no banco */
export const dayStart = (day: string) => `${day}T00:00:00${OFFSET}`;
export const dayEnd = (day: string) => `${day}T23:59:59.999${OFFSET}`;

/** soma dias a uma data pura "aaaa-mm-dd" */
export const addDaysISO = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00${OFFSET}`);
  d.setUTCDate(d.getUTCDate() + n);
  return todayISO(d);
};
