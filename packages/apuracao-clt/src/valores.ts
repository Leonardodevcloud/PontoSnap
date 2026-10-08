import type { RegrasApuracao, ResultadoPeriodo } from './tipos.js';

/** Parâmetros de folha para valorizar a apuração (tudo em centavos). */
export interface ParametrosValor {
  salarioMensalCentavos: number;
  horasMensaisFolha: number; // divisor da folha (ex.: 220 para 44h/semana)
}

export interface ResultadoValores {
  valorHoraCentavos: number;
  extrasPorAdicionalCentavos: Record<string, number>;
  extrasCentavos: number;              // total pago em extras (base + adicional)
  adicionalNoturnoCentavos: number;    // só o adicional (a hora-base já está no salário)
  reflexoDsrCentavos: number;
  descontoFaltasCentavos: number;
  descontoAtrasosCentavos: number;
  descontoDsrPerdidoCentavos: number;
  liquidoProventosCentavos: number;    // proventos - descontos (parcial, só o que a apuração toca)
  /** Minutos de extra que NÃO foram pagos porque foram pro banco de horas. */
  extrasNoBancoMin: number;
}

/**
 * Para onde cada coisa vai — decide o que vira R$ NESTA folha.
 * Sem isto, tudo é valorizado (comportamento antigo, sem banco).
 */
export interface DestinoValores {
  /**
   * Banco ativo: a extra comum vira crédito no banco e NÃO é paga agora
   * (senão a mesma hora aparece duas vezes: no banco e em R$). Indenização de
   * intervalo/interjornada é sempre paga — não é jornada, não vai pro banco.
   */
  extrasNoBanco?: boolean;
  /** Falta vira desconto em R$ só com destinação DESCONTA (banco/abono não descontam). */
  descontaFaltas?: boolean;
  /** Atraso vira desconto em R$ só com destinação DESCONTA (banco/tolera não descontam). */
  descontaAtrasos?: boolean;
}

const ehIndenizacao = (motivo: string) => motivo.startsWith('indenização');

const porMin = (min: number, taxaHoraCentavos: number) => Math.round((min / 60) * taxaHoraCentavos);

/**
 * Converte a apuração (em minutos) em valores de folha (em centavos).
 * Não é a folha completa — cobre só o que a jornada gera: extras com adicional,
 * adicional noturno, reflexo de DSR e os descontos de falta/atraso/DSR perdido.
 */
export function valorizarPeriodo(
  r: ResultadoPeriodo, p: ParametrosValor, regras: RegrasApuracao, dest: DestinoValores = {},
): ResultadoValores {
  const valorHora = Math.round(p.salarioMensalCentavos / p.horasMensaisFolha);
  const descontaFaltas = dest.descontaFaltas ?? true;
  const descontaAtrasos = dest.descontaAtrasos ?? true;

  // Extras que viram dinheiro nesta folha. Com banco, só a indenização.
  let pagasPorAdicional: Record<string, number> = r.extrasPorAdicional;
  let extrasNoBancoMin = 0;
  if (dest.extrasNoBanco) {
    pagasPorAdicional = {};
    for (const d of r.dias) {
      for (const e of d.extras) {
        if (ehIndenizacao(e.motivo)) {
          const k = String(e.adicionalPct);
          pagasPorAdicional[k] = (pagasPorAdicional[k] ?? 0) + e.min;
        } else {
          extrasNoBancoMin += e.min;
        }
      }
    }
  }
  const pagasMin = Object.values(pagasPorAdicional).reduce((a, b) => a + b, 0);

  const extrasPorAdicionalCentavos: Record<string, number> = {};
  let extras = 0;
  for (const [pct, min] of Object.entries(pagasPorAdicional)) {
    const v = Math.round(porMin(min, valorHora) * (1 + Number(pct) / 100));
    extrasPorAdicionalCentavos[pct] = v;
    extras += v;
  }

  const adicionalNoturno = Math.round(porMin(r.totalNoturnoLegalMin, valorHora) * (regras.noturno.adicionalPct / 100));
  // Reflexo do DSR só sobre a extra que é paga (proporcional).
  const reflexoMin = r.totalExtrasMin > 0 ? Math.round(r.reflexoDsrMin * (pagasMin / r.totalExtrasMin)) : 0;
  const reflexoDsr = porMin(reflexoMin, valorHora);
  const descFaltas = descontaFaltas ? porMin(r.totalFaltaMin, valorHora) : 0;
  const descAtrasos = descontaAtrasos ? porMin(r.totalAtrasoMin, valorHora) : 0;
  const salarioDia = Math.round(p.salarioMensalCentavos / 30);
  // Falta abonada/compensada no banco não é falta injustificada pra perda de DSR.
  const descDsrPerdido = descontaFaltas ? r.dsrPerdidoSemanas * salarioDia : 0;

  const liquido = extras + adicionalNoturno + reflexoDsr - descFaltas - descAtrasos - descDsrPerdido;

  return {
    valorHoraCentavos: valorHora,
    extrasPorAdicionalCentavos,
    extrasCentavos: extras,
    adicionalNoturnoCentavos: adicionalNoturno,
    reflexoDsrCentavos: reflexoDsr,
    descontoFaltasCentavos: descFaltas,
    descontoAtrasosCentavos: descAtrasos,
    descontoDsrPerdidoCentavos: descDsrPerdido,
    liquidoProventosCentavos: liquido,
    extrasNoBancoMin,
  };
}
