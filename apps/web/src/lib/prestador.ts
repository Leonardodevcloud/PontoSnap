import type { FechadoIndividual } from '../tipos';
/** Tipos e utilidades do portal do prestador (app restrito e telas do RH). */

export type StatusNota = 'AGUARDANDO' | 'ENVIADA' | 'APROVADA' | 'RECUSADA';
export type Situacao = 'NAO_LIBERADO' | 'FALTA' | 'CONFERIR' | 'RECUSADA' | 'CONTESTOU' | 'APROVADA' | 'RH';

export interface LinhaDetalhe { rotulo: string; valorCent: number; tipo?: 'BASE' | 'MAIS' | 'MENOS' }
export interface Conferencia {
  arquivo: 'PDF' | 'XML' | 'FOTO'; origem: 'XML' | 'PDF' | 'INFORMADO';
  valorBate: boolean | null; numeroRepetido: boolean; competenciaOk: boolean | null; tomadorOk: boolean | null; prestadorOk: boolean | null;
  /** Código do serviço e descrição × o pedido do modelo (null = não deu para ler / sem modelo). */
  codigoOk?: boolean | null; descricaoOk?: boolean | null;
  lido?: { numero?: string | null; data?: string | null; valorCent?: number | null; cnpjTomador?: string | null; cnpjPrestador?: string | null; codigoServico?: string | null; descricao?: string | null };
  bate: boolean;
}
export interface ArquivoNf { id: string; nome: string; mime: string; bytes: number }
export interface Nota {
  id: string; pessoaTipo: 'MEI' | 'MOTORISTA'; competencia: string; periodo: string; rotulo: string; fim: string | null;
  valorCent: number; detalhe: LinhaDetalhe[]; versao: number; liberadoEm: string; prazo: string | null;
  pedirConfirmacao: boolean; status: StatusNota; vistoEm: string | null;
  confirmacao: 'CONFERE' | 'CONTESTOU' | null; contestacao: string | null; resposta: string | null; respondidoEm: string | null;
  enviadaEm: string | null; motivoRecusa: string | null; conferidaEm: string | null; conferencia: Conferencia | null; nfValorCent: number | null;
  nf: { numero: string | null; data: string | null; arquivo: ArquivoNf | null };
  pago: boolean; pagoEm: string | null; valorPagoCent: number | null; lembretes: number; lembreteEm: string | null;
  /** Só no app: descrição pronta para colar no emissor. */
  descricao?: string;
  /** O que foi pedido (modelo de nota congelado ao liberar). */
  pedido?: PedidoNota | null;
  /** Bloco para "Copiar tudo". */
  textoPedido?: string | null;
}
export interface PedidoNota {
  modeloId: string | null; modeloNome: string | null;
  tomador: { cnpj: string; razao: string; endereco: string | null; telefone: string | null; email: string | null };
  codigoServico: string | null; codigoDescricao: string | null; descricao: string; observacao: string | null; valorCent: number;
}
export interface ModeloNota {
  id: string; nome: string; padraoTipo: 'MEI' | 'MOTORISTA' | null;
  tomadorCnpj: string; tomadorRazao: string; tomadorEndereco: string | null; tomadorTelefone: string | null; tomadorEmail: string | null;
  codigoServico: string | null; codigoDescricao: string | null; descricao: string; observacao: string | null;
  usadoPor: number; escolhidoPor: number;
}
export interface ListaModelos {
  modelos: ModeloNota[]; semModelo: { id: string; nome: string; tipo: 'MEI' | 'MOTORISTA' }[]; empresa: { razao: string; cnpj: string };
  pessoas: { id: string; nome: string; tipo: 'MEI' | 'MOTORISTA'; modeloNotaId: string | null; modeloEfetivoId: string | null }[];
}
export interface Eu {
  prestador: { id: string; nome: string; tipo: 'MEI' | 'MOTORISTA'; funcao: string | null; empresa: string | null; documento: string | null; email: string | null; chavePix: string | null; telefone: string | null; avatarSemente: number | null };
  empresa: string; tomador: { nome: string; cnpj: string }; emissorUrl: string; notas: Nota[];
}

export const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const brl = (c: number) => `R$ ${reais(c)}`;
export const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
export const dataIsoBr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
export const fmtTel = (t: string | null) => {
  const d = (t ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : t ?? '';
};
export const fmtCnpj = (c: string) => (c.length === 14 ? c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'));

/** Passo atual (1 fechado · 2 nota enviada · 3 aprovada · 4 pago). */
export function passoDe(n: Nota): number {
  if (n.pago) return 4;
  if (n.status === 'APROVADA') return 3;
  if (n.status === 'ENVIADA') return 2;
  return 1;
}

/** A nota em destaque no início: a mais recente ainda em andamento; senão, a mais recente. */
export function notaEmDestaque(notas: Nota[]): Nota | null {
  const abertas = notas.filter((n) => n.status !== 'APROVADA' || !n.pago);
  const urgente = abertas.find((n) => n.status === 'RECUSADA') ?? abertas.find((n) => n.status === 'AGUARDANDO');
  return urgente ?? abertas[0] ?? notas[0] ?? null;
}

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  NAO_LIBERADO: 'não liberado', FALTA: 'falta nota', CONFERIR: 'enviada · conferir', RECUSADA: 'recusada',
  CONTESTOU: 'contestou o valor', APROVADA: 'aprovada', RH: 'RH subiu a nota',
};
export const TOM_SITUACAO: Record<Situacao, 'ok' | 'av' | 'er' | 'in' | 'cz'> = {
  NAO_LIBERADO: 'cz', FALTA: 'av', CONFERIR: 'in', RECUSADA: 'er', CONTESTOU: 'er', APROVADA: 'ok', RH: 'ok',
};

/** Tag de situação para o prestador. */
export function statusParaPrestador(n: Nota): { texto: string; tom: 'ok' | 'av' | 'er' | 'in' | 'cz' } {
  if (n.pago) return { texto: `pago${n.pagoEm ? ` ${dataIsoBr(n.pagoEm)}` : ''}`, tom: 'ok' };
  if (n.status === 'APROVADA') return { texto: 'aprovada', tom: 'ok' };
  if (n.status === 'ENVIADA') return { texto: 'enviada · RH conferindo', tom: 'in' };
  if (n.status === 'RECUSADA') return { texto: 'RH pediu outra', tom: 'er' };
  if (n.confirmacao === 'CONTESTOU' && !n.resposta) return { texto: 'valor contestado', tom: 'av' };
  return { texto: 'falta enviar', tom: 'av' };
}

// ───────────── RH ─────────────

export type StatusAcesso = 'ATIVO' | 'CONVIDADO' | 'SEM' | 'BLOQUEADO' | 'CONVITE_VENCIDO';
export interface UnidadeRh {
  periodo: string; rotulo: string; valorCent: number; situacao: Situacao; atrasada: boolean; pago: boolean;
  valorPagoCent: number | null; pagoEm: string | null; nota: Nota | null;
  nf: { numero: string | null; arquivo: (ArquivoNf & { pessoaId: string; competencia: string; periodo: string }) | null }; tipo: 'MEI' | 'MOTORISTA';
}
export interface LinhaRh {
  id: string; tipo: 'MEI' | 'MOTORISTA'; nome: string; valorCent: number; unidades: UnidadeRh[];
  empresa: string | null; funcao: string | null; documento: string | null; telefone: string | null; email: string | null;
  tomadorNome: string | null; tomadorCnpj: string | null; avatarSemente: number | null;
  cidade?: { uf: string | null; municipio: number; municipioNome: string | null } | null;
  acesso: { status: StatusAcesso; temPush: boolean; conviteExpiraEm: string | null };
  situacao: Situacao; atrasada: boolean; vistoEm: string | null; pago: boolean; pagoCent: number;
  /** Fechado sozinho no mês (desligamento / pagar antes do fechamento). */
  fechadoIndividual: FechadoIndividual | null;
  /** Modelo de nota que vale para a pessoa (padrão = o do tipo, sem escolha). */
  modeloNotaId: string | null; modeloNota: { id: string; nome: string; padrao: boolean } | null;
}
export interface PainelRh {
  competencia: string; rotulo: string; fechado: boolean; fechadoEm: string | null; hoje: string; meiLiberado: boolean;
  semanas: { inicio: string; fim: string; encerrada: boolean; liberada: boolean; motoristas: number; valorCent: number }[];
  totais: {
    pessoas: number; mei: number; motoristas: number; aPagarCent: number; comAcesso: number; convidados: number; semAcesso: number;
    notas: number; recebidas: number; conferir: number; faltam: number; recusadas: number; aprovadas: number; contestaram: number; pagos: number; pagosCent: number;
  };
  linhas: LinhaRh[];
}
export interface NotaFila extends Nota { pessoaId: string; nome: string; documento: string | null; empresa: string | null; avatarSemente: number | null; tomadorEsperado: string | null; pedido?: PedidoNota | null }
export interface ConviteGerado { prestadorId: string; nome: string; erro?: string; telefone?: string | null; email?: string | null; codigo?: string; link?: string; mensagem?: string; whatsapp?: string | null; emailEnviado?: boolean; expiraEm?: string }

/** "há 2 dias", "hoje", "ontem". */
export function haQuanto(iso: string | null): string {
  if (!iso) return '';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return dias <= 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`;
}
