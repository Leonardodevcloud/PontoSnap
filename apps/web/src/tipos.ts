export type Perfil = 'MASTER' | 'ADMIN_CLIENTE' | 'RH' | 'COLABORADOR';

export interface RespLogin {
  accessToken: string;
  refreshToken: string;
  perfil: Perfil;
  tenantId: string | null;
  deveTrocarSenha?: boolean;
  fuso?: string;
  empresas?: EmpresaAcesso[];
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
  /** null quando a batida entrou por ajuste aprovado (não tem NSR no AFD). */
  nsr: number | null;
  dtMarcacao: string;
  coletor: number;
  incluida?: boolean;
}

export interface LocalEstabelecimento {
  latitude: number;
  longitude: number;
  raioMetros: number | null;
}

export interface MinhasMarcacoes {
  nome: string;
  esperadas?: number;
  horarioPares?: Array<{ entrada: string; saida: string }>;
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
  escalaCodigo?: string | null;
  cctId?: string | null;
  perfilRegraId?: string | null;
  dataInicioPonto?: string | null;
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
  fora?: boolean;
  distancia?: number | null;
  offline?: boolean;
  defasagemSeg?: number | null;
  /** Marcação desconsiderada por ajuste aprovado (não conta na apuração). */
  desconsiderada?: boolean;
  motivoAjuste?: string | null;
  marcacaoId?: string;
}

export interface EspelhoResp {
  nome: string;
  matricula: string | null;
  /** Batidas previstas pelo horário contratual (2 por par). 0 = sem horário. */
  esperadas?: number;
  horarioPares?: Array<{ entrada: string; saida: string }>;
  marcacoes: MarcacaoEspelho[];
  /** Batidas que entraram por ajuste aprovado (não têm NSR). */
  incluidas?: { dtMarcacao: string; tpMarc: string | null; motivo: string }[];
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
  /** Batida em aberto ou hoje em andamento: sem falta/atraso/extra até ser tratado. */
  pendente?: boolean;
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
  diasPendentes?: string[];
  /** Jornada esperada no mês inteiro (inclui os dias que ainda não chegaram). */
  totalContratadoMesMin?: number;
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
  /** Extra que foi pro banco de horas (não é paga nesta folha). */
  extrasNoBancoMin?: number;
  /** Indenização de intervalo/interjornada — já incluída em extrasCentavos. */
  indenizacaoMin?: number;
  indenizacaoCentavos?: number;
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
  jornadaPorDia?: Record<string, number> | null;
  /** Contrato de horas: só a carga do dia conta, sem horário fixo. */
  flexivel?: boolean;
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
  marcacoesPorTipo?: {
    total: number;
    entradas: number;
    saidasAlmoco: number;
    retornos: number;
    saidas: number;
  };
  pendencias: {
    atestados: number;
    ajustes?: number;
    revisar: { nome: string; data: string }[];
    revisarTotal: number;
    naoBateram: { nome: string; desde: string }[];
    naoBateramTotal: number;
    noPrazo?: number;
    folgaHoje?: number;
    semJornadaHoje?: number;
    aindaNaoIniciou?: number;
  };
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
  /** Pra onde vão faltas/atrasos/extras, segundo a regra do funcionário. */
  destinacao?: Destinacao;
  /** Banco de horas no contexto do período: anterior + mês = acumulado. Null = sem banco. */
  banco?: BancoPeriodo | null;
  /** Batidas de cada dia (chave = YYYY-MM-DD) com a origem de cada uma. */
  batidas?: Record<string, BatidaDia[]>;
  /** Batidas previstas pelo horário contratual (2 por par). */
  esperadas?: number;
  horarioPares?: { entrada: string; saida: string }[];
  horarioDurMin?: number;
  jornadaPorDia?: Record<string, number> | null;
  horarioFlexivel?: boolean;
}

export interface BatidaDia {
  dtMarcacao: string;
  origem: 'ORIGINAL' | 'INCLUIDA' | 'DESCONSIDERADA';
  motivo: string | null;
}

export interface Destinacao {
  falta: { min: number; destino: 'DESCONTA' | 'BANCO' | 'ABONA' };
  atraso: { min: number; destino: 'DESCONTA' | 'BANCO' | 'TOLERA' };
  extra: { min: number; destino: 'BANCO' | 'PAGA' };
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

export interface BancoPeriodo {
  ativo: true;
  formaCalculo: 'BANCO_HORAS' | 'INTRA_MES';
  prazoMeses: number;
  competencia: string;
  /** O mês já foi fechado no banco (lançado). */
  fechada: boolean;
  saldoAnteriorMin: number;
  /** O que o mês leva pro banco (fechado: o lançado; em andamento: a apuração de agora). */
  saldoMesMin: number;
  /** Folgas, pagamentos e ajustes do RH dentro do período. */
  avulsoMin: number;
  saldoAcumuladoMin: number;
  /** Fechado com valor diferente do que a apuração dá hoje → refazer o mês. */
  desatualizado: boolean;
}

export interface MovimentoBanco {
  id?: string;
  data: string;
  minutos: number;
  tipo: 'CREDITO' | 'DEBITO' | 'PAGAMENTO' | 'AJUSTE';
  descricao?: string;
  competencia?: string | null;
}

export interface FechamentoBanco {
  competencia: string;
  totalMin: number;
  fechadoEm: string;
  origem: 'AUTO' | 'MANUAL';
}

export interface BancoResp {
  ativo: boolean;
  tipoAcordo: TipoAcordoBanco;
  prazoMeses: number | null;
  formaCalculo: 'BANCO_HORAS' | 'INTRA_MES';
  saldo: SaldoBanco | null;
  extrato: MovimentoBanco[];
  /** Mês em andamento, ainda não fechado. */
  mesCorrente: { competencia: string; estimadoMin: number } | null;
  /** Saldo oficial + mês em andamento. */
  saldoProjetadoMin: number | null;
  fechamentos: FechamentoBanco[];
}

export interface ConfigBanco {
  tipoAcordo: TipoAcordoBanco;
  prazoMeses: number | null;
  ativo: boolean;
}

export interface CompetenciaFunc { nome: string; minutos: number; }
export interface CompetenciaLancada {
  competencia: string;
  funcionarios: number;
  totalMin: number;
  lancadoEm: string;
  /** true quando todos os fechamentos da competência foram automáticos. */
  automatico: boolean;
  porFuncionario: CompetenciaFunc[];
}
export interface LoteResultado {
  competencia: string;
  funcionarios: number;
  totalMin: number;
  porFuncionario: { empregadoId: string; nome: string; minutos: number }[];
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

export interface Cct {
  id: string;
  nome: string;
  uf: string | null;
  vigencia: string | null;
  extraDiaUtilPct: number;
  extraDomingoFeriadoPct: number;
  extraLimiteDiarioMin: number;
  toleranciaDiariaMin: number;
  toleranciaPorMarcacaoMin: number;
  noturnoAdicionalPct: number;
  noturnoReduzida: boolean;
  noturnoInicioMin: number;
  noturnoFimMin: number;
  jornadaSemanalMin: number;
  interjornadaMinimaMin: number;
  intervaloMaior6hMin: number;
  bancoPrazoMeses: number | null;
  bancoModo: 'HERDA' | 'ATIVO' | 'INATIVO';
  bancoTipoAcordo: 'INDIVIDUAL' | 'COLETIVO' | null;
  ativa: boolean;
  padrao: boolean;
  destinacaoFaltas: 'DESCONTA' | 'BANCO' | 'ABONA';
  destinacaoAtrasos: 'DESCONTA' | 'BANCO' | 'TOLERA';
  formaCalculo: 'BANCO_HORAS' | 'INTRA_MES';
  funcionarios?: number;
}

export interface AjusteMeu {
  id: string;
  tipo: 'INCLUSAO' | 'DESCONSIDERAR';
  data: string;
  status: 'EM_ANALISE' | 'APROVADO' | 'RECUSADO';
  observacao: string;
  motivoDecisao: string | null;
  dtMarcacao: string | null;
  tpMarc: string | null;
}

export interface EmpresaAcesso {
  tenantId: string;
  perfil: 'ADMIN_CLIENTE' | 'RH';
  razaoSocial: string;
  cnpj: string;
}

// ---- Relatório da competência (todos os funcionários) ----

export interface SinaisCompetencia {
  impar: number;
  intervalo: number;
  interjornada: number;
  faltaDias: string[];
  emAbertoHoje: boolean;
  pendentes?: number;
}

export interface LinhaCompetencia {
  empregadoId: string;
  nome: string;
  matricula: string | null;
  temSalario: boolean;
  regime: string;
  horarioDurMin: number;
  trabalhadoMin: number;
  contratadoMin: number;
  /** Jornada esperada no mês inteiro. */
  contratadoMesMin?: number;
  /** Extra que foi pro banco (não entra em R$). */
  extrasNoBancoMin?: number;
  extrasMin: number;
  extra50Min: number;
  extra100Min: number;
  faltaMin: number;
  atrasoMin: number;
  noturnoMin: number;
  saldoMesMin: number;
  dsrPerdidoSemanas: number;
  extrasCentavos: number;
  adicionalNoturnoCentavos: number;
  descontosCentavos: number;
  liquidoProventosCentavos: number;
  banco: BancoPeriodo | null;
  destinacao?: Destinacao;
  sinais: SinaisCompetencia;
  afastamentos?: { tipo: TipoAfastamento; dataInicio: string; dataFim: string; observacao: string | null }[];
  assinada: boolean;
}

export interface RelatorioCompetencia {
  inicio: string;
  fim: string;
  competencia: string;
  hoje: string;
  linhas: LinhaCompetencia[];
  totais: {
    trabalhadoMin: number; contratadoMin: number; contratadoMesMin?: number; extrasMin: number; extra50Min: number; extra100Min: number;
    faltaMin: number; atrasoMin: number; noturnoMin: number; saldoMesMin: number;
    bancoAnteriorMin: number; bancoAcumuladoMin: number; comBanco: number;
    extrasCentavos: number; adicionalNoturnoCentavos: number; descontosCentavos: number; liquidoProventosCentavos: number;
    assinadas: number; pendencias: number;
  };
}

// ---- Banco de horas: visão de todos ----

export type LinhaResumoBanco =
  | { empregadoId: string; nome: string; matricula: string | null; ativo: false; tipoAcordo: TipoAcordoBanco; formaCalculo: 'BANCO_HORAS' | 'INTRA_MES' }
  | {
      empregadoId: string; nome: string; matricula: string | null; ativo: true;
      tipoAcordo: TipoAcordoBanco; formaCalculo: 'BANCO_HORAS' | 'INTRA_MES'; prazoMeses: number | null;
      saldoMin: number; mesCorrenteMin: number; projetadoMin: number;
      creditadoMin: number; compensadoMin: number; pagoMin: number;
      devedorMin: number; vencidoMin: number; aVencerMin: number; proximoVencimento: string | null;
      ultimoMovimento: { data: string; minutos: number; descricao: string } | null;
      fechamentos: number; ultimoFechamento: string | null;
    };

export interface ResumoBanco {
  hoje: string;
  competencia: string;
  linhas: LinhaResumoBanco[];
  totais: {
    funcionarios: number; comBanco: number;
    saldoMin: number; mesCorrenteMin: number; projetadoMin: number;
    vencidoMin: number; aVencerMin: number; devedorMin: number;
    comVencido: number; comAVencer: number; devendo: number;
  };
}

// ---- Gestão de Pessoal ----

export type PessoaTipo = 'CLT' | 'MEI' | 'MOTORISTA';
export type VtTipo = 'NENHUM' | 'DIA' | 'FIXO';
export type BaseDias = 'SEG_SAB' | 'SEG_SEX';
export type MotivoNaoUso = 'feriado' | 'falta' | 'afastamento';

export interface PessoalLinhaClt {
  empregadoId: string; nome: string; matricula: string | null;
  config: {
    cargo: string | null; vrDiaCent: number; cestaCent: number; vtTipo: VtTipo; vtValorCent: number; chavePix: string | null;
    /** PADRAO = segue o padrão da empresa · PROPRIO = valor da pessoa · NENHUM = sem benefício */
    origem: 'PADRAO' | 'PROPRIO' | 'NENHUM';
    /** Mês do benefício a partir do qual esse valor vale. */
    vigenteDesde: string | null;
  };
  /** Salário do mês (proporcional se mudou no meio). */
  salarioCent: number | null;
  /** Trechos do mês por salário (promoção/reajuste). 1 trecho = sem mudança. */
  salarioPartes: { desde: string; ate: string; dias: number; salarioCent: number; valorCent: number }[];
  diasMes: number; valorDiaMesCent: number; valorDia30Cent: number; valorHoraCent: number;
  /** Hora extra (sem indenização) e quanto dela foi pro banco de horas. */
  heMin: number; heNoBancoMin: number;
  /** Indenização de intervalo/interjornada (Art. 71 §4º): sempre paga, não é hora extra. */
  indenizacaoMin: number; indenizacaoCent: number;
  proventosCent: number;
  faltasDias: string[]; descontosCent: number; debitosCent: number;
  beneficios: {
    diasProx: number; diasProxLista: string[]; pagosEstimado: boolean;
    vrProxCent: number; vtProxCent: number;
    naoUsados: { data: string; motivo: MotivoNaoUso }[];
    acertoVrCent: number; acertoVtCent: number; acertoCent: number; cargaCent: number;
    /** Cesta do mês apurado: paga só sem falta e depois da carência. */
    cestaCent: number; cestaStatus: 'PAGA' | 'PERDIDA_FALTA' | 'CARENCIA' | 'SEM_CESTA';
    cestaDesde: string | null; cestaDesdeOrigem: 'MANUAL' | 'AUTO' | null;
  };
  liquidoSalarioCent: number; custoBrutoCent: number; abatimentosCent: number; liquidoPagarCent: number;
  observacao: string | null; erro: string | null;
}
export interface PessoalLancMei {
  heMin: number; faltas: number; feriadosTrab: number; metaCent: number; metaPaga: boolean; metaPagaEm: string | null;
  nfNumero: string | null; nfData: string | null; pago: boolean; observacao: string | null;
  /** Quanto foi pago e quando (null enquanto não pago). */
  valorPagoCent: number | null; pagoEm: string | null;
  nfArquivo: PessoalNfArquivo | null;
}
/** Arquivo da NF enviado (metadados; o conteúdo vem de /pessoal/nf/:id). */
export interface PessoalNfArquivo { id: string; nome: string; mime: string; bytes: number; enviadoEm: string }
export interface PessoalPagamentoMes { pago: boolean; valorPagoCent: number | null; pagoEm: string | null }
export interface PessoalLinhaMei {
  id: string; nome: string; documento: string | null; funcao: string | null; empresa: string | null; valorCent: number; chavePix: string | null;
  /** Desde quando vale o valor deste mês, e o histórico de reajustes (mais recente primeiro). */
  valorDesde: string; historicoValores: { vigenteDesde: string; valorCent: number; baseDias: BaseDias }[];
  baseDias: BaseDias; diasMes: number; lanc: PessoalLancMei; debitosCent: number;
  valorDiaCent: number; valorHoraCent: number; heCent: number; feriadosCent: number; faltasCent: number;
  brutoCent: number; metaDescontadaCent: number; abatimentosCent: number; liquidoCent: number;
}
export interface PessoalSemanaMot { inicio: string; fim: string; diasAuto: number; dias: number; adicionalCent: number; nfNumero: string | null; pago: boolean; totalCent: number; nfArquivo: PessoalNfArquivo | null }
export interface PessoalLinhaMot {
  id: string; nome: string; documento: string | null; funcao: string | null; empresa: string | null; valorCent: number; chavePix: string | null;
  /** Desde quando vale o valor deste mês, e o histórico de reajustes (mais recente primeiro). */
  valorDesde: string; historicoValores: { vigenteDesde: string; valorCent: number; baseDias: BaseDias }[];
  baseDias: BaseDias; diasMes: number; diariaCent: number; semanas: PessoalSemanaMot[];
  totalCent: number; debitosCent: number; liquidoCent: number; observacao: string | null;
  pagamento: PessoalPagamentoMes;
}
export interface PessoalDebito {
  id: string; pessoaTipo: PessoaTipo; pessoaId: string; nome: string; descricao: string;
  valorTotalCent: number; parcelas: number; competenciaInicio: string; parcelaAtual: number; parcelaCent: number;
}
export interface PessoalCompetencia {
  competencia: string; proxima: string; fechado: boolean; fechadoEm: string | null;
  feriados: string[];
  clt: PessoalLinhaClt[]; mei: PessoalLinhaMei[]; motoristas: PessoalLinhaMot[]; debitos: PessoalDebito[];
  semanas: { inicio: string; fim: string }[];
  foraDoMes: { exclusaoId: string; pessoaTipo: PessoaTipo; pessoaId: string; nome: string; escopo: 'MES' | 'DIANTE'; desde: string }[];
  totais: { pessoas: { clt: number; mei: number; motoristas: number }; brutoCent: number; abatimentosCent: number; liquidoCent: number; beneficiosCent: number };
  pendencias: { nfMei: number; nfMotorista: number; semSalario: number; semPonto: number };
  /** Padrão da empresa vigente para a carga do próximo mês. */
  padrao: PessoalPadrao | null;
  padroes: PessoalPadrao[];
}
export interface PessoalPadrao { vigenteDesde: string; vrDiaCent: number; cestaCent: number; vtTipo: VtTipo; vtValorCent: number }
export interface PessoalPessoa { pessoaTipo: PessoaTipo; pessoaId: string; nome: string }
