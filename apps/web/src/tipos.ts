export type Perfil = 'MASTER' | 'ADMIN_CLIENTE' | 'RH' | 'COLABORADOR';

export interface RespLogin {
  accessToken: string;
  refreshToken: string;
  perfil: Perfil;
  tenantId: string | null;
  deveTrocarSenha?: boolean;
  fuso?: string;
}

export interface Tenant {
  id: string;
  cnpj: string;
  razaoSocial: string;
  localPrestacao: string | null;
  fuso?: string;
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
  /** Batida capturada sem rede — a hora veio do relógio do aparelho. */
  offline?: boolean;
  /** Defasagem aparelho→servidor em segundos, quando offline. */
  defasagemSeg?: number | null;
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
  /** Férias/licenças do período — a tela escreve o motivo no dia. */
  afastamentos?: { tipo: TipoAfastamento; dataInicio: string; dataFim: string; observacao: string | null }[];
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

// ---- Banco de horas ----

export type TipoAcordoBanco = 'NENHUM' | 'INDIVIDUAL' | 'COLETIVO';

export interface LoteBanco {
  data: string;
  minutosRestantes: number;
  venceEm: string;
  vencido: boolean;
}

export interface SaldoBanco {
  saldoMin: number;
  creditadoMin: number;
  compensadoMin: number;
  pagoMin: number;
  devedorMin: number;
  vencidoMin: number;
  aVencerMin: number;
  proximoVencimento: string | null;
  lotes: LoteBanco[];
}

export interface MovimentoBanco {
  data: string;
  minutos: number;
  tipo: 'CREDITO' | 'DEBITO' | 'PAGAMENTO' | 'AJUSTE';
  descricao?: string;
}

export interface BancoResp {
  ativo: boolean;
  tipoAcordo: TipoAcordoBanco;
  prazoMeses: number | null;
  saldo: SaldoBanco | null;
  extrato: MovimentoBanco[];
}

export interface ConfigBanco {
  tipoAcordo: TipoAcordoBanco;
  prazoMeses: number | null;
  ativo: boolean;
}

// ---- Atestados e declarações ----

export type TipoDocumento = 'ATESTADO' | 'COMPARECIMENTO';
export type StatusDocumento = 'EM_ANALISE' | 'ABONADO' | 'RECUSADO';

export interface Documento {
  id: string;
  empregadoId: string;
  tipo: TipoDocumento;
  dataInicio: string;
  dataFim: string;
  minutos: number | null;
  status: StatusDocumento;
  motivoRecusa: string | null;
  arquivoNome: string;
  arquivoMime: string;
  arquivoBytes: number;
  enviadoEm: string;
  analisadoEm: string | null;
  /** Só na listagem do RH. */
  nome?: string;
  matricula?: string | null;
}

// ---- Férias, INSS e licenças ----

export type TipoAfastamento = 'FERIAS' | 'INSS' | 'MATERNIDADE' | 'PATERNIDADE' | 'SUSPENSAO' | 'OUTRO';

export interface Afastamento {
  id: string;
  empregadoId: string;
  tipo: TipoAfastamento;
  dataInicio: string;
  dataFim: string;
  observacao: string | null;
  nome?: string;
}

// ---- Trilha de auditoria ----

export interface LinhaAuditoria {
  id: string;
  usuarioEmail: string | null;
  usuarioPerfil: string | null;
  acao: string;
  detalhe: Record<string, unknown> | null;
  statusHttp: string | null;
  ip: string | null;
  em: string;
}

// ---- Cobrança ----

export interface Plano {
  id: string;
  nome: string;
  modo: 'FIXO' | 'POR_FUNCIONARIO';
  valor: number;
  descricao: string | null;
}

export interface Assinatura {
  id: string;
  tenantId: string;
  planoId: string | null;
  modoOverride: 'FIXO' | 'POR_FUNCIONARIO' | null;
  valorOverride: string | null;
  diaVencimento: number;
  situacao: string;
}

export interface Cobranca {
  id: string;
  tenantId: string;
  competencia: string;
  valor: number;
  qtdFuncionarios: number | null;
  vencimento: string;
  status: 'ABERTA' | 'PAGA' | 'ATRASADA' | 'CANCELADA';
  boletoUrl: string | null;
  pagoEm: string | null;
  avisoPagamentoEm: string | null;
  atrasada?: boolean;
  diasAtraso?: number;
}

export interface PainelCobranca {
  assinaturas: Assinatura[];
  cobrancas: Cobranca[];
  planos: Plano[];
}

export interface MinhaAssinatura {
  assinatura: Assinatura | null;
  cobrancas: Cobranca[];
  emAberto: Cobranca | null;
}
