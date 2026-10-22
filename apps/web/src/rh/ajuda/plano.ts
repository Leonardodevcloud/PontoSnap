import type { Horario } from '../../tipos';

/**
 * Assistente de compensação: a partir das respostas, decide qual escala e
 * qual perfil de regra cada pessoa precisa. Reaproveita o que já existe
 * (mesma carga, dias e horários) e só cria variações quando falta.
 * Puro (sem API) para dar para testar.
 */
export type Jornada = 'FIXO' | 'CARGA';
export type Comp = 'NAO' | 'SEMANA' | 'MES' | 'ACUMULA';
export interface Respostas {
  jornada: Jornada; comp: Comp;
  faltas: 'DESCONTA' | 'BANCO'; negativo: 'DESCONTA' | 'CARREGA';
  acordo: 'INDIVIDUAL' | 'COLETIVO'; prazo: number;
}
export interface PerfilCfg { id: string; nome: string; padrao: boolean; config?: Record<string, unknown> }
export type NovaEscala = Omit<Horario, 'id' | 'criadoEm'>;

export const ROT_COMP: Record<Comp, string> = { NAO: 'não compensa', SEMANA: 'compensa na semana', MES: 'compensa no mês', ACUMULA: 'acumula' };

/** Forma canônica para comparar configs (ordem das chaves não importa). */
export function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${k}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export function bancoAlvo(r: Respostas) {
  if (r.comp === 'MES') return { bancoModo: 'ATIVO', bancoTipoAcordo: r.acordo, bancoPrazoMeses: null, formaCalculo: 'INTRA_MES', negativoMes: r.negativo };
  if (r.comp === 'ACUMULA') return { bancoModo: 'ATIVO', bancoTipoAcordo: r.acordo, bancoPrazoMeses: r.prazo, formaCalculo: 'BANCO_HORAS' };
  return { bancoModo: 'INATIVO', bancoTipoAcordo: null, bancoPrazoMeses: null, formaCalculo: 'BANCO_HORAS' };
}

/** Config do perfil: mantém extra, tolerância, noturno e intervalos da pessoa; troca banco e destino; tira o "contrato" antigo. */
export function configAlvo(atual: Record<string, unknown> | undefined, r: Respostas): Record<string, unknown> {
  const { banco: _b, destinacao: _d, contrato: _c, ...resto } = atual ?? {};
  const comBanco = r.comp === 'MES' || r.comp === 'ACUMULA';
  return { ...resto, banco: bancoAlvo(r), destinacao: { destinacaoFaltas: comBanco ? r.faltas : 'DESCONTA', destinacaoAtrasos: 'BANCO' } };
}

/** Perfil que a pessoa deve usar: um existente com a mesma config, ou um novo. */
export function perfilAlvo(efetivo: PerfilCfg | null, r: Respostas, perfis: PerfilCfg[]): { existente: PerfilCfg } | { novo: { nome: string; config: Record<string, unknown> } } {
  const cfg = configAlvo(efetivo?.config, r);
  const c = canon(cfg);
  const igual = (efetivo && canon(efetivo.config ?? {}) === c ? efetivo : null) ?? perfis.find((p) => canon(p.config ?? {}) === c);
  if (igual) return { existente: igual };
  const base = efetivo?.nome.replace(/\s·\s(não compensa|compensa na semana|compensa no mês|acumula)$/i, '') ?? 'Regra';
  let nome = `${base} · ${ROT_COMP[r.comp]}`.slice(0, 120);
  let i = 2;
  while (perfis.some((p) => p.nome.toLowerCase() === nome.toLowerCase())) nome = `${base} · ${ROT_COMP[r.comp]} ${i++}`.slice(0, 120);
  return { novo: { nome, config: cfg } };
}

const mesmosDias = (a: number[], b: number[]) => [...a].sort().join() === [...b].sort().join();
const mesmaCarga = (a: Horario, b: Horario) => a.durJornadaMin === b.durJornadaMin && mesmosDias(a.diasSemana, b.diasSemana) && canon(a.jornadaPorDia ?? null) === canon(b.jornadaPorDia ?? null);

/** Escala com a mesma carga/dias/horários da base, mas no tipo pedido. */
export function escalaAlvo(base: Horario, r: Respostas, todas: Horario[]): { existente: Horario } | { nova: NovaEscala } | { doze: Horario } | { semHorario: Horario } {
  if (base.regime === 'r12x36') return { doze: base };
  const flexivel = r.jornada === 'CARGA';
  const compensaSemana = r.comp === 'SEMANA';
  const temPares = (base.pares ?? []).length > 0;
  const serve = (h: Horario) => h.regime !== 'r12x36' && !!h.flexivel === flexivel && !!h.compensaSemana === compensaSemana && mesmaCarga(h, base)
    // horário fixo precisa dos mesmos horários; vindo de contrato de horas (sem horários), qualquer fixo com a mesma carga serve
    && (flexivel || !temPares || canon(h.pares) === canon(base.pares)) && (flexivel || (h.pares ?? []).length > 0);
  if (serve(base)) return { existente: base };
  const achou = todas.find(serve);
  if (achou) return { existente: achou };
  if (!flexivel && !temPares) return { semHorario: base };
  const raiz = base.codigo.replace(/\s(CH|SEM|FIXO)(\s(SEM))?\d*$/i, '').trim();
  const partes = [flexivel && !base.flexivel ? 'CH' : '', !flexivel && base.flexivel ? 'FIXO' : '', compensaSemana ? 'SEM' : ''].filter(Boolean);
  const suf = ` ${partes.length ? partes.join(' ') : flexivel ? 'CH' : 'FIXO'}`;
  let codigo = `${raiz.slice(0, 30 - suf.length)}${suf}`;
  let i = 2;
  while (todas.some((h) => h.codigo.toLowerCase() === codigo.toLowerCase())) codigo = `${raiz.slice(0, 30 - suf.length - 2)}${suf}${i++}`;
  return { nova: { codigo, durJornadaMin: base.durJornadaMin, pares: base.pares, diasSemana: base.diasSemana, regime: 'normal', jornadaPorDia: base.jornadaPorDia ?? null, flexivel, compensaSemana } };
}

/** Frase do resultado com a semana de exemplo (9h · 7h · 8h30 · 7h30 · 8h). */
export function resultadoExemplo(r: Respostas) {
  if (r.comp === 'NAO') return 'Paga 1h30 de extra e desconta 1h30 de atraso (cada dia fecha sozinho).';
  if (r.comp === 'SEMANA') return 'A semana fecha em 40h: nada pago, nada descontado.';
  if (r.comp === 'MES') return `Nada pago, nada descontado. No fim do mês, o que sobrar é pago como extra; o que faltar ${r.negativo === 'CARREGA' ? 'passa para o mês seguinte' : 'é descontado'}.`;
  return `Nada pago, nada descontado. O saldo fica no banco para folga e vence em ${r.prazo} meses.`;
}
