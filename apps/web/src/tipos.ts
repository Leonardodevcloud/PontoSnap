export type Perfil = 'MASTER' | 'ADMIN_CLIENTE' | 'RH' | 'COLABORADOR';

export interface RespLogin {
  accessToken: string;
  refreshToken: string;
  perfil: Perfil;
  tenantId: string | null;
  deveTrocarSenha?: boolean;
}

export interface Tenant {
  id: string;
  cnpj: string;
  razaoSocial: string;
  localPrestacao: string | null;
  ativo: boolean;
  criadoEm?: string;
}

export interface Marcacao {
  latitude?: number | null;
  longitude?: number | null;
  observacao?: string | null;
  nsr: number;
  dtMarcacao: string;
  coletor: number;
}

export interface LocalEstabelecimento {
  latitude: number;
  longitude: number;
  raioMetros: number | null;
}

export interface MinhasMarcacoes {
  nome: string;
  /** Quantas marcações o dia prevê pelo horário contratual. 0 = desconhecido. */
  esperadas?: number;
  /** Local da empresa. null = sem endereço cadastrado (ex.: empresa remota). */
  local?: LocalEstabelecimento | null;
  marcacoes: Marcacao[];
}

export interface Batida {
  nsr: number;
  dtMarcacao: string;
  hash: string;
}

export interface Empregado {
  emailAcesso?: string | null;
  salarioMensal?: string | null;
  id: string;
  cpf: string;
  nome: string;
  matricula: string | null;
  pis: string | null;
  ativo: boolean;
  temPin: boolean;
  matriculaEsocial?: string | null;
  horarioContratualId?: string | null;
}

export interface InfoCertificado {
  cn: string | null;
  validade: string | null;
  ativo: boolean;
}

export interface ResumoJornada {
  minutosTrabalhados: number;
  minutosContratados: number;
  saldoMinutos: number;
  minutosNoturnos: number;
  paresIncompletos: boolean;
}

export interface MarcacaoEspelho {
  nsr: number;
  dtMarcacao: string;
  latitude?: number | null;
  longitude?: number | null;
  observacao?: string | null;
  /** true quando a batida saiu de fora do raio do estabelecimento. */
  fora?: boolean;
  /** Distância em metros até o estabelecimento. null = sem localização. */
  distancia?: number | null;
}

export interface EspelhoResp {
  nome: string;
  matricula: string | null;
  marcacoes: MarcacaoEspelho[];
  resumo: ResumoJornada;
}

export interface ExtraClassificada { min: number; adicionalPct: number; motivo: string; }

export interface ResultadoDiaCLT {
  data: string;
  /** Eco das batidas do dia (ISO). */
  marcacoes: string[];
  ehDescansoDia: boolean;
  faltaInjustificada: boolean;
  minutosTrabalhados: number;
  minutosContratados: number;
  minutosNoturnosReais: number;
  minutosNoturnosLegais: number;
  extras: ExtraClassificada[];
  extrasTotalMin: number;
  faltaMin: number;
  atrasoMin: number;
  saldoMin: number;
  intervaloGozadoMin: number;
  penalidadeIntervaloMin: number;
  penalidadeInterjornadaMin: number;
  violacaoInterjornada: boolean;
  paresIncompletos: boolean;
  observacoes: string[];
}

export interface ResultadoPeriodoCLT {
  dias: ResultadoDiaCLT[];
  totalTrabalhadoMin: number;
  totalContratadoMin: number;
  totalExtrasMin: number;
  extrasPorAdicional: Record<string, number>;
  totalNoturnoLegalMin: number;
  totalFaltaMin: number;
  totalAtrasoMin: number;
  saldoPeriodoMin: number;
  bancoDeHorasMin: number;
  reflexoDsrMin: number;
  dsrPerdidoSemanas: number;
  diasComViolacao: string[];
}

export interface ValoresApuracao {
  valorHoraCentavos: number;
  extrasCentavos: number;
  adicionalNoturnoCentavos: number;
  reflexoDsrCentavos: number;
  descontoFaltasCentavos: number;
  descontoAtrasosCentavos: number;
  descontoDsrPerdidoCentavos: number;
  liquidoProventosCentavos: number;
}

export interface ApuracaoResp {
  nome: string;
  matricula: string | null;
  inicio: string;
  fim: string;
  regras: string;
  resultado: ResultadoPeriodoCLT;
  valores: ValoresApuracao | null;
}

export interface Feriado {
  id: string;
  data: string;
  nome: string;
  tipo: string;
  criadoEm?: string;
}

export interface ParEntradaSaida { entrada: string; saida: string; }
export interface Horario {
  id: string;
  codigo: string;
  durJornadaMin: number;
  pares: ParEntradaSaida[];
  diasSemana: number[];
  regime: string;
  criadoEm?: string;
}

export interface PainelResp {
  data: string;
  ativos: number;
  presentes: number;
  ausentes: number;
  listaAusentes: { nome: string; matricula: string | null }[];
  marcacoesHoje: number;
  ultimas: { nome: string; dt: string; coletor: number }[];
}

export interface RelatorioLinha {
  empregadoId: string;
  nome: string;
  matricula: string | null;
  temSalario: boolean;
  trabalhadoMin: number;
  extrasMin: number;
  faltaMin: number;
  atrasoMin: number;
  noturnoMin: number;
  dsrPerdidoSemanas: number;
  extrasCentavos: number;
  adicionalNoturnoCentavos: number;
  liquidoProventosCentavos: number;
}

export interface RelatorioResp {
  inicio: string;
  fim: string;
  linhas: RelatorioLinha[];
  totais: {
    trabalhadoMin: number; extrasMin: number; faltaMin: number; atrasoMin: number; noturnoMin: number;
    extrasCentavos: number; adicionalNoturnoCentavos: number; liquidoProventosCentavos: number;
  };
}

// ---- Apuração e escala do próprio colaborador ----



export interface ApuracaoResp {
  nome: string;
  matricula: string | null;
  inicio: string;
  fim: string;
  resultado: ResultadoPeriodoCLT;
}

export interface ParEntradaSaida { entrada: string; saida: string; }

export interface MinhaEscalaResp {
  horario: {
    codigo: string;
    pares: ParEntradaSaida[];
    diasSemana: number[];
    durJornadaMin: number;
  } | null;
  /** Datas geradas por escala (12x36). Vazio = segue os diasSemana do horário. */
  escala: string[];
  feriados: { data: string; nome: string }[];
}
