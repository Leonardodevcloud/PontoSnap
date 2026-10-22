/** Tipos e rótulos do raio-x de compensação de horas (API /ajuda/compensacao). */

export type NivelCompensacao = 'SEM_ESCALA' | 'NAO' | 'SEMANA' | 'MES' | 'ACUMULA';
export type TipoJornada = 'FIXO' | 'CONTRATO_HORAS' | '12X36';
export interface AlertaComp { codigo: string; gravidade: 'erro' | 'aviso' | 'info'; texto: string }
export interface Compensacao {
  empregadoId: string; nome: string; matricula: string | null;
  escala: { id: string; codigo: string; regime: string; flexivel: boolean; compensaSemana: boolean; durJornadaMin: number; diasSemana: number[]; tipo: TipoJornada; cargaSemanaMin: number } | null;
  contratoLegado: boolean; jornada: TipoJornada | null;
  perfil: { id: string; nome: string; origem: 'PROPRIO' | 'PADRAO' | 'NENHUM' } | null;
  origemPerfil: 'PROPRIO' | 'PADRAO' | 'NENHUM';
  banco: { ativo: boolean; modo: 'NAO' | 'MES' | 'ACUMULA'; origem: 'PERFIL' | 'EMPRESA'; tipoAcordo: string | null; prazoMeses: number | null; negativoMes: 'DESCONTA' | 'CARREGA' };
  destinacao: { faltas: 'DESCONTA' | 'BANCO' | 'ABONA'; atrasos: 'DESCONTA' | 'BANCO' | 'TOLERA' };
  semana: boolean; nivel: NivelCompensacao;
  niveis: { dia: boolean; semana: boolean; mes: boolean; acumula: boolean };
  alertas: AlertaComp[]; resumo: string;
  proximaEscala: { codigo: string; aPartirDe: string } | null;
}
export interface EmpresaBanco { tipoAcordo: string; prazoMeses: number | null }
export interface RespCompensacao {
  empresa: EmpresaBanco; perfilPadrao: string | null;
  totais: { pessoas: number; semEscala: number; nao: number; semana: number; mes: number; acumula: number; atencao: number; avisos: number };
  linhas: Compensacao[];
}
export interface RaioX extends Compensacao { empresa: EmpresaBanco; historico: { codigo: string; dataInicio: string; dataFim: string | null }[] }

export const NIVEL: Record<NivelCompensacao, { rot: string; tom: 'ok' | 'in' | 'er' | 'av' | 'cz' }> = {
  SEM_ESCALA: { rot: 'sem escala', tom: 'av' },
  NAO: { rot: 'não compensa', tom: 'cz' },
  SEMANA: { rot: 'compensa na semana', tom: 'ok' },
  MES: { rot: 'compensa no mês', tom: 'ok' },
  ACUMULA: { rot: 'acumula no banco', tom: 'in' },
};
export const temAtencao = (c: Compensacao) => c.alertas.some((a) => a.gravidade === 'erro');
export const JORNADA: Record<TipoJornada, string> = { FIXO: 'Horário fixo', CONTRATO_HORAS: 'Contrato de horas', '12X36': '12x36' };
export const acordoEmpresaTxt = (e: EmpresaBanco) => e.tipoAcordo === 'NENHUM' ? 'sem acordo de banco'
  : `acordo ${e.tipoAcordo === 'COLETIVO' ? 'coletivo' : 'individual'}${e.prazoMeses ? ` · ${e.prazoMeses} meses` : ''}`;
export const hhmm = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
