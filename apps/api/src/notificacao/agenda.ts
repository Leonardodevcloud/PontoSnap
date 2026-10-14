import type { TipoNotificacao } from './push.service';

/**
 * Regras puras do que mandar agora para um funcionário (sem banco, testável).
 * O cron chama a cada 2 minutos; a deduplicação (chave única por usuário) fica
 * no PushService, então as janelas aqui podem ser largas sem repetir envio.
 */

/** "0800", "08:00" ou "8:00" → minutos desde a meia-noite. Inválido → null. */
export function hhmmParaMin(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /^(\d{1,2}):?(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export interface DiaDoFuncionario {
  pares: { entrada: string; saida: string }[];
  /** Carga do dia quando a escala tem jornada diferente por dia (ex.: sábado 4h). */
  jornadaDiaMin: number | null;
  /** Contrato de horas: sem horário fixo, não há lembrete nem "esqueceu". */
  flexivel: boolean;
  /** Batidas já feitas hoje. */
  marcacoes: number;
  lembreteAntes: boolean;
  lembreteMinutos: number;
}
export interface Envio { tipo: TipoNotificacao; chave: string; titulo: string; corpo: string; url: string }

/** Janela depois do horário em que o "esqueceu?" ainda faz sentido. */
export const ESQUECEU_DE = 15;
export const ESQUECEU_ATE = 120;

export function agendaDoMomento(d: DiaDoFuncionario, agora: number, hoje: string): Envio[] {
  if (d.flexivel || d.pares.length === 0) return [];
  // Meio período (até 6h) numa escala de dois turnos: só o primeiro turno vale.
  const pares = d.jornadaDiaMin != null && d.jornadaDiaMin <= 360 && d.pares.length > 1 ? [d.pares[0]!] : d.pares;
  const slots: { min: number; nome: string; tipoEsq: TipoNotificacao }[] = [];
  pares.forEach((p, i) => {
    const e = hhmmParaMin(p.entrada), s = hhmmParaMin(p.saida);
    const ultimo = i === pares.length - 1;
    if (e != null) slots.push({ min: e, nome: i === 0 ? 'entrada' : 'volta do almoço', tipoEsq: i === 0 ? 'esqueceuEntrada' : 'esqueceuAlmoco' });
    if (s != null) slots.push({ min: s, nome: ultimo ? 'saída' : 'saída pro almoço', tipoEsq: ultimo ? 'esqueceuSaida' : 'esqueceuAlmoco' });
  });

  const out: Envio[] = [];
  // Lembrete: dentro dos X minutos antes da próxima batida que ainda não aconteceu.
  if (d.lembreteAntes) {
    slots.forEach((s, k) => {
      const falta = s.min - agora;
      if (falta > 0 && falta <= d.lembreteMinutos && d.marcacoes < k + 1) {
        const t = textoLembrete(s.nome, fmt(s.min));
        out.push({ tipo: 'lembreteAntes', chave: `lembrete-${k}-${hoje}`, ...t, url: '/' });
      }
    });
  }
  // Esqueceu: só a primeira batida que ficou para trás (não manda uma por slot).
  const k = d.marcacoes;
  const s = slots[k];
  if (s) {
    const atraso = agora - s.min;
    if (atraso >= ESQUECEU_DE && atraso <= ESQUECEU_ATE) {
      const t = textoEsquecimento(s.nome, fmt(s.min));
      out.push({ tipo: s.tipoEsq, chave: `esqueceu-${k}-${hoje}`, ...t, url: '/' });
    }
  }
  return out;
}

function textoLembrete(nome: string, h: string) {
  switch (nome) {
    case 'entrada': return { titulo: 'Hora de bater o ponto', corpo: `Sua entrada é às ${h}. Toque para abrir o app.` };
    case 'saída pro almoço': return { titulo: 'Hora do almoço', corpo: `Seu intervalo começa às ${h}. Bata o ponto antes de sair.` };
    case 'volta do almoço': return { titulo: 'Almoço terminando', corpo: `Sua volta é às ${h}. Não esquece de bater.` };
    default: return { titulo: 'Quase na hora de sair', corpo: `Sua saída é às ${h}. Bata o ponto antes de ir.` };
  }
}
function textoEsquecimento(nome: string, h: string) {
  switch (nome) {
    case 'entrada': return { titulo: 'Esqueceu a entrada?', corpo: `Sua entrada era às ${h} e ainda não tem batida hoje.` };
    case 'saída pro almoço': return { titulo: 'Saiu para o almoço?', corpo: `O intervalo era às ${h} e a batida ainda não apareceu.` };
    case 'volta do almoço': return { titulo: 'Voltou do almoço?', corpo: `Sua volta era às ${h} e a batida ainda não apareceu.` };
    default: return { titulo: 'Esqueceu a saída?', corpo: `Seu expediente acabou às ${h} e falta a batida de saída.` };
  }
}
