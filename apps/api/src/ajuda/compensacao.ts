/**
 * Como as horas de um funcionário são contadas DE VERDADE, juntando as peças
 * que o motor de apuração usa (escala do dia, perfil próprio → perfil padrão →
 * CLT, acordo de banco da empresa e destino de faltas/atrasos).
 *
 * Espelha as decisões de:
 *  - montar-regras.ts  jornadaFlexivel (escala.flexivel OU perfil antigo CONTRATO_HORAS)
 *  - tratamento.service apurarPeriodoCLT (banco ATIVO/INATIVO/HERDA → empresa ≠ NENHUM)
 *  - destinacao.ts     efetivo() (BANCO vira DESCONTA sem banco)
 *  - semana.ts         compensaSemana (ignorado em 12x36)
 * Se uma dessas regras mudar, mude aqui também (há teste cobrindo cada caso).
 */

export type NivelCompensacao = 'SEM_ESCALA' | 'NAO' | 'SEMANA' | 'MES' | 'ACUMULA';
export type TipoJornada = 'FIXO' | 'CONTRATO_HORAS' | '12X36';
export type OrigemPerfil = 'PROPRIO' | 'PADRAO' | 'NENHUM';
export type Gravidade = 'erro' | 'aviso' | 'info';

export interface EscalaIn {
  id: string; codigo: string; regime: string; flexivel: boolean; compensaSemana: boolean;
  durJornadaMin: number; diasSemana: number[]; jornadaPorDia?: Record<string, number> | null;
}
export interface PerfilIn { id: string; nome: string; padrao: boolean; config: unknown }
export interface EmpresaBanco { tipoAcordo: string; prazoMeses: number | null }

interface CfgBanco { bancoModo?: string; bancoTipoAcordo?: string | null; bancoPrazoMeses?: number | null; formaCalculo?: string; negativoMes?: string }
interface CfgDest { destinacaoFaltas?: string; destinacaoAtrasos?: string }
interface CfgPerfil { banco?: CfgBanco | null; destinacao?: CfgDest | null; contrato?: { tipoJornada?: string } | null }

export interface Alerta { codigo: string; gravidade: Gravidade; texto: string }

export interface Compensacao {
  escala: (EscalaIn & { tipo: TipoJornada; cargaSemanaMin: number }) | null;
  /** Perfil antigo marcando "contrato de horas": força flexível mesmo com escala fixa. */
  contratoLegado: boolean;
  /** Jornada que vale no cálculo (escala + perfil antigo). */
  jornada: TipoJornada | null;
  perfil: { id: string; nome: string; origem: OrigemPerfil } | null;
  origemPerfil: OrigemPerfil;
  banco: {
    ativo: boolean; modo: 'NAO' | 'MES' | 'ACUMULA';
    /** De onde veio: escolhido no perfil ou herdado do acordo da empresa. */
    origem: 'PERFIL' | 'EMPRESA';
    tipoAcordo: string | null; prazoMeses: number | null; negativoMes: 'DESCONTA' | 'CARREGA';
  };
  destinacao: { faltas: 'DESCONTA' | 'BANCO' | 'ABONA'; atrasos: 'DESCONTA' | 'BANCO' | 'TOLERA' };
  semana: boolean;
  nivel: NivelCompensacao;
  niveis: { dia: boolean; semana: boolean; mes: boolean; acumula: boolean };
  alertas: Alerta[];
  /** Frase curta para a lista. */
  resumo: string;
}

const PRAZO_PADRAO: Record<string, number> = { INDIVIDUAL: 6, COLETIVO: 12 };

function cargaSemana(e: EscalaIn) {
  return (e.diasSemana ?? []).reduce((s, d) => s + (e.jornadaPorDia?.[String(d)] ?? e.durJornadaMin), 0);
}

export function classificarCompensacao(escala: EscalaIn | null, perfil: PerfilIn | null, origemPerfil: OrigemPerfil, empresa: EmpresaBanco): Compensacao {
  const cfg = (perfil?.config ?? {}) as CfgPerfil;
  const b = cfg.banco ?? null;

  // Banco: ATIVO/INATIVO no perfil decidem; HERDA (ou sem bloco) segue a empresa.
  let ativo: boolean, origem: 'PERFIL' | 'EMPRESA';
  if (b && b.bancoModo && b.bancoModo !== 'HERDA') { ativo = b.bancoModo === 'ATIVO'; origem = 'PERFIL'; }
  else { ativo = empresa.tipoAcordo !== 'NENHUM'; origem = 'EMPRESA'; }
  const forma = b?.formaCalculo === 'INTRA_MES' && origem === 'PERFIL' ? 'INTRA_MES' : 'BANCO_HORAS';
  const tipo = ativo ? (origem === 'PERFIL' ? (b?.bancoTipoAcordo ?? (empresa.tipoAcordo === 'NENHUM' ? 'INDIVIDUAL' : empresa.tipoAcordo)) : empresa.tipoAcordo) : null;
  const prazo = ativo && forma !== 'INTRA_MES' ? ((origem === 'PERFIL' ? b?.bancoPrazoMeses : null) ?? empresa.prazoMeses ?? PRAZO_PADRAO[tipo ?? ''] ?? null) : null;
  const banco = {
    ativo, origem, modo: (!ativo ? 'NAO' : forma === 'INTRA_MES' ? 'MES' : 'ACUMULA') as 'NAO' | 'MES' | 'ACUMULA',
    tipoAcordo: tipo, prazoMeses: prazo, negativoMes: (b?.negativoMes === 'CARREGA' ? 'CARREGA' : 'DESCONTA') as 'DESCONTA' | 'CARREGA',
  };

  // Destino efetivo: sem banco, "abater do banco" vira desconto.
  const fRaw = (cfg.destinacao?.destinacaoFaltas ?? 'DESCONTA') as Compensacao['destinacao']['faltas'];
  const aRaw = (cfg.destinacao?.destinacaoAtrasos ?? 'BANCO') as Compensacao['destinacao']['atrasos'];
  const destinacao = { faltas: fRaw === 'BANCO' && !ativo ? 'DESCONTA' : fRaw, atrasos: aRaw === 'BANCO' && !ativo ? 'DESCONTA' : aRaw } as Compensacao['destinacao'];

  const contratoLegado = cfg.contrato?.tipoJornada === 'CONTRATO_HORAS';
  const e12 = escala?.regime === 'r12x36';
  const tipoEsc: TipoJornada | null = !escala ? null : e12 ? '12X36' : escala.flexivel ? 'CONTRATO_HORAS' : 'FIXO';
  const jornada: TipoJornada | null = !escala ? null : e12 ? '12X36' : (escala.flexivel || contratoLegado) ? 'CONTRATO_HORAS' : 'FIXO';
  const semana = !!escala && !e12 && escala.compensaSemana;

  const nivel: NivelCompensacao = !escala ? 'SEM_ESCALA'
    : banco.modo === 'ACUMULA' ? 'ACUMULA' : banco.modo === 'MES' ? 'MES' : semana ? 'SEMANA' : 'NAO';

  const alertas: Alerta[] = [];
  if (!escala) alertas.push({ codigo: 'SEM_ESCALA', gravidade: 'erro', texto: 'Sem escala: o ponto não é calculado até definir uma escala.' });
  if (escala && jornada === 'CONTRATO_HORAS' && nivel === 'NAO') {
    alertas.push({ codigo: 'CONTRATO_SEM_COMPENSACAO', gravidade: 'erro',
      texto: 'Contrato de horas sem banco e sem "compensa na semana": cada dia fecha sozinho (hora a mais é paga, hora a menos é descontada).' });
  }
  if (contratoLegado && escala && !escala.flexivel && !e12) {
    alertas.push({ codigo: 'CONTRATO_LEGADO', gravidade: 'aviso',
      texto: `O perfil "${perfil?.nome}" ainda marca "contrato de horas" (forma antiga) e isso vence a escala fixa. Tire do perfil e escolha na escala.` });
  }
  if (ativo && aRaw === 'DESCONTA') {
    alertas.push({ codigo: 'ATRASO_DESCONTA_COM_BANCO', gravidade: 'aviso',
      texto: 'Tem banco, mas os atrasos são descontados na folha: a hora a mais vai para o banco e a hora a menos não abate dela.' });
  }
  if ((ativo || semana) && destinacao.faltas === 'DESCONTA') {
    alertas.push({ codigo: 'FALTA_DESCONTA', gravidade: 'info',
      texto: 'Falta de dia inteiro é descontada (com DSR), não abate das horas a mais.' });
  }
  if (origemPerfil === 'NENHUM') {
    alertas.push({ codigo: 'SEM_PERFIL', gravidade: 'info', texto: 'Sem perfil próprio e a empresa não tem perfil padrão: vale a CLT pura.' });
  }
  if (origem === 'EMPRESA' && !ativo && escala) {
    alertas.push({ codigo: 'BANCO_EMPRESA_SEM_ACORDO', gravidade: 'info',
      texto: perfil ? `O perfil "${perfil.nome}" segue o banco da empresa, e a empresa não tem acordo de banco: fica sem banco.` : 'A empresa não tem acordo de banco: fica sem banco.' });
  }

  const resumo = nivel === 'SEM_ESCALA' ? 'não calcula até ter escala'
    : nivel === 'ACUMULA' ? `acumula no banco · vence em ${prazo ?? '?'} meses`
    : nivel === 'MES' ? `paga o que sobrar no mês · ${banco.negativoMes === 'CARREGA' ? 'devendo passa' : 'devendo desconta'}`
    : nivel === 'SEMANA' ? 'total da semana (seg→dom)'
    : jornada === 'CONTRATO_HORAS' ? 'cada dia fecha sozinho' : 'extra paga, atraso descontado';

  return {
    escala: escala ? { ...escala, tipo: tipoEsc!, cargaSemanaMin: cargaSemana(escala) } : null,
    contratoLegado, jornada,
    perfil: perfil ? { id: perfil.id, nome: perfil.nome, origem: origemPerfil } : null, origemPerfil,
    banco, destinacao, semana, nivel,
    niveis: { dia: true, semana: semana || ativo, mes: ativo, acumula: banco.modo === 'ACUMULA' },
    alertas, resumo,
  };
}
