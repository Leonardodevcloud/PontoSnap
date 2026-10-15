/**
 * Fechamento de UMA pessoa (prestador) no mês — regras puras, sem banco.
 *
 * Desligamento: contrato do MEI proporcional aos dias trabalhados (mesma base
 * de dias que a folha usa) ou mês cheio; motorista: só as semanas/dias até o
 * último dia. Parcelas de débito que iam cair depois entram agora.
 */
import { calcularSemanaMotorista, diasBase, parcelaNoMes, somarMeses, type DebitoParcelado } from './calculo';
import type { LinhaMei, LinhaMot } from './pessoal.service';

export type MotivoFechamento = 'DESLIGAMENTO' | 'ANTECIPADO';
export interface OpcoesFechamento { motivo: MotivoFechamento; ultimoDia: string | null; proporcional: boolean }

/** Soma das parcelas que cairiam DEPOIS de `comp` (o fixo não entra: ele só acaba). */
export function debitosDepois(debs: DebitoParcelado[], comp: string): number {
  let total = 0;
  for (const d of debs) {
    if (d.tipo === 'FIXO') continue;
    for (let i = 1; i <= d.parcelas; i++) {
      const pc = parcelaNoMes(d, somarMeses(comp, i));
      if (!pc) break;
      total += pc.valorCent;
    }
  }
  return total;
}

/** Dias da base (seg–sex/seg–sáb, sem feriado) do mês até o último dia (inclusive). */
export function diasAte(comp: string, base: 'SEG_SEX' | 'SEG_SAB', feriados: Set<string>, ultimoDia: string): number {
  return diasBase(comp, base, feriados).filter((d) => d <= ultimoDia).length;
}

/** MEI congelado: contrato proporcional (se pedido) e débitos futuros somados. */
export function congelarMei(m: LinhaMei, o: OpcoesFechamento, feriados: Set<string>, comp: string, futurosCent: number): LinhaMei {
  let contratoCent = m.valorCent;
  let proporcional: LinhaMei['proporcional'];
  if (o.motivo === 'DESLIGAMENTO' && o.proporcional && o.ultimoDia) {
    const dias = diasAte(comp, m.baseDias, feriados, o.ultimoDia);
    contratoCent = Math.round((m.valorCent * dias) / Math.max(1, m.diasMes));
    proporcional = { dias, diasMes: m.diasMes, contratoCent };
  }
  const brutoCent = m.brutoCent - m.valorCent + contratoCent;
  const debitosCent = m.debitosCent + futurosCent;
  const abatimentosCent = m.abatimentosCent + futurosCent;
  return { ...m, proporcional, debitosFuturosCent: futurosCent || undefined, brutoCent, debitosCent, abatimentosCent, liquidoCent: brutoCent - abatimentosCent };
}

/**
 * Motorista congelado: semanas depois do último dia zeram; a semana do último
 * dia conta só até ele. Débitos futuros somam no mês (e são descontados na
 * última semana trabalhada — quem grava é o serviço).
 */
export function congelarMot(m: LinhaMot, o: OpcoesFechamento, feriados: Set<string>, comp: string, futurosCent: number): LinhaMot {
  const ultimo = o.motivo === 'DESLIGAMENTO' ? o.ultimoDia : null;
  const base = new Set(diasBase(comp, m.baseDias, feriados));
  const semanas = m.semanas.map((s) => {
    if (!ultimo || s.fim <= ultimo) return s;
    if (s.inicio > ultimo) return { ...s, dias: 0, adicionalCent: 0, totalCent: 0 };
    let ate = 0;
    for (let d = s.inicio; d <= ultimo; d = proxDia(d)) if (base.has(d)) ate++;
    const dias = Math.min(s.dias, ate);
    return { ...s, dias, totalCent: calcularSemanaMotorista({ mensalCent: m.valorCent, diasMes: m.diasMes, dias, adicionalCent: s.adicionalCent }).totalCent };
  });
  const totalCent = Math.round((m.valorCent / Math.max(1, m.diasMes)) * semanas.reduce((a, s) => a + s.dias, 0))
    + semanas.reduce((a, s) => a + s.adicionalCent, 0);
  const debitosCent = m.debitosCent + futurosCent;
  return {
    ...m, semanas, totalCent, debitosCent, liquidoCent: totalCent - debitosCent, debitosFuturosCent: futurosCent || undefined,
    debitoPendenteCent: Math.max(0, debitosCent - semanas.reduce((a, s) => a + s.debitoAplicadoCent, 0)),
  };
}

function proxDia(d: string): string {
  const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}
