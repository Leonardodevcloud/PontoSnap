import { minutosParaHhMm } from './formato';
import type { ApuracaoResp, ResultadoDiaCLT } from '../tipos';

/**
 * "Por que deu esse número?": monta, a partir da apuração de um funcionário no
 * mês, a conta em português de cada total da tabela. Tudo sai dos mesmos dias
 * que a apuração somou, então a conta sempre fecha com o número clicado.
 */
export type CampoExplicavel = 'extras' | 'faltas' | 'atrasos' | 'atrfal' | 'saldo' | 'banco';

export interface LinhaConta {
  op: '' | '+' | '−' | '=' | '→';
  rotulo: string;
  detalhe?: string;
  valor: string;
  /** zero = não entrou na conta (riscado); total = linha de resultado. */
  estilo?: 'zero' | 'total';
}
export interface Explicacao {
  titulo: string;
  resumo: string;
  linhas: LinhaConta[];
  nota?: string;
  regras: { rotulo: string; texto: string; rota: string }[];
}

const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dia = (iso: string) => `${DOW[new Date(`${iso}T12:00:00-0300`).getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const curto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const hh = (m: number) => minutosParaHhMm(Math.abs(m));
const sinal = (m: number) => `${m > 0 ? '+' : m < 0 ? '−' : ''}${hh(m)}`;
const MAX_LINHAS = 10;

/** Junta as linhas que passam do limite numa só, para a conta caber na tela. */
function limitar(l: LinhaConta[], op: LinhaConta['op'], rotuloResto: (n: number) => string, soma: (x: LinhaConta[]) => string): LinhaConta[] {
  if (l.length <= MAX_LINHAS) return l;
  const resto = l.slice(MAX_LINHAS - 1);
  return [...l.slice(0, MAX_LINHAS - 1), { op, rotulo: rotuloResto(resto.length), valor: soma(resto) }];
}

function regrasDe(ap: ApuracaoResp): Explicacao['regras'] {
  const compensa = ap.resultado.dias.some((d) => d.semana);
  const carga = ap.horarioDurMin ? `${hh(ap.horarioDurMin)}/dia` : 'sem carga definida';
  const escala = [
    ap.horarioFlexivel ? 'contrato de horas' : 'horário fixo',
    compensa ? 'compensa na semana' : null,
    ap.jornadaPorDia ? 'carga diferente por dia' : carga,
  ].filter(Boolean).join(' · ');
  const d = ap.destinacao;
  const regra = d ? [
    `extra ${d.extra.destino === 'BANCO' ? 'vai para o banco' : 'é paga na folha'}`,
    `falta ${d.falta.destino === 'DESCONTA' ? 'desconta' : d.falta.destino === 'BANCO' ? 'sai do banco' : 'é abonada'}`,
    `atraso ${d.atraso.destino === 'DESCONTA' ? 'desconta' : d.atraso.destino === 'BANCO' ? 'sai do banco' : 'é tolerado'}`,
  ].join(' · ') : 'segue a CLT';
  const banco = ap.banco ? (ap.banco.formaCalculo === 'INTRA_MES' ? 'compensa no mês e paga a diferença' : `acumula · prazo ${ap.banco.prazoMeses} meses`) : 'sem banco de horas';
  return [
    { rotulo: 'Escala', texto: escala, rota: '/rh/escalas' },
    { rotulo: 'Regra de cálculo', texto: `${regra} · ${banco}`, rota: '/rh/regras' },
  ];
}

/** Semanas de quem compensa na semana, na ordem, sem repetir. */
function semanasDe(dias: ResultadoDiaCLT[]) {
  const m = new Map<string, NonNullable<ResultadoDiaCLT['semana']>>();
  for (const d of dias) if (d.semana && !m.has(d.semana.inicio)) m.set(d.semana.inicio, d.semana);
  return [...m.values()].sort((a, b) => a.inicio.localeCompare(b.inicio));
}

function explicarExtras(ap: ApuracaoResp): Explicacao {
  const dias = ap.resultado.dias;
  const total = ap.resultado.totalExtrasMin;
  const semanas = semanasDe(dias);
  const linhas: LinhaConta[] = [];

  for (const s of semanas) {
    const rot = `Semana ${curto(s.inicio)}–${curto(s.fim)}`;
    if (s.estado !== 'FECHADA') {
      linhas.push({ op: '', rotulo: rot, detalhe: s.estado === 'PROXIMO_MES' ? 'termina no mês seguinte e fecha lá' : s.pendente ? 'aberta: tem batida faltando' : 'ainda aberta: fecha no domingo', valor: '—', estilo: 'zero' });
      continue;
    }
    const dif = s.feitoMin - s.cargaMin;
    if (s.resultadoMin > 0) linhas.push({ op: '+', rotulo: rot, detalhe: `${hh(s.feitoMin)} feitas − ${hh(s.cargaMin)} de carga`, valor: `+${hh(s.resultadoMin)}` });
    else if (dif > 0) linhas.push({ op: '', rotulo: rot, detalhe: `${hh(s.feitoMin)} − ${hh(s.cargaMin)} = +${hh(dif)}, dentro da tolerância: não conta`, valor: '0h00', estilo: 'zero' });
  }
  // Extras do próprio dia (sem compensação, ou fora dela: domingo, feriado, acima de 10h, intervalo).
  const porDia: LinhaConta[] = [];
  for (const d of dias) {
    const ex = d.extras.filter((x) => x.motivo !== 'extra da semana');
    const min = ex.reduce((a, x) => a + x.min, 0);
    if (min <= 0) continue;
    const motivo = [...new Set(ex.map((x) => x.motivo))].join(', ');
    const det = d.semana ? motivo : `${hh(d.minutosTrabalhados)} feitas − ${hh(d.minutosContratados)} de carga${motivo && !/^extra/.test(motivo) ? ` · ${motivo}` : ''}`;
    porDia.push({ op: '+', rotulo: dia(d.data), detalhe: det, valor: `+${hh(min)}` });
  }
  linhas.push(...limitar(porDia, '+', (n) => `Mais ${n} dias`, (r) => `+${hh(r.reduce((a, x) => a + (parseHh(x.valor)), 0))}`));
  const dest = ap.destinacao?.extra.destino;
  linhas.push({ op: '=', rotulo: 'Extras do mês', detalhe: dest === 'BANCO' ? 'vão para o banco de horas' : 'pagas na folha (50% dia útil, 100% domingo e feriado)', valor: `+${hh(total)}`, estilo: 'total' });

  const resumo = semanas.length
    ? 'A escala compensa na semana: o que vale é o total de segunda a domingo, não cada dia. Só a semana que passou da carga (além da tolerância) gera extra.'
    : 'Cada dia que passou da carga da escala, além da tolerância, gera extra naquele dia.';
  return { titulo: `Por que +${hh(total)} de extra?`, resumo, linhas: linhas.length > 1 ? linhas : [{ op: '', rotulo: 'Nenhum dia passou da carga', valor: '0h00', estilo: 'zero' }, ...linhas], regras: regrasDe(ap) };
}

function parseHh(v: string): number {
  const m = /(\d+)h(\d{2})/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function explicarFaltasAtrasos(ap: ApuracaoResp, campo: 'faltas' | 'atrasos' | 'atrfal'): Explicacao {
  const dias = ap.resultado.dias;
  const r = ap.resultado;
  const linhas: LinhaConta[] = [];
  const querFalta = campo !== 'atrasos', querAtraso = campo !== 'faltas';
  const semanas = semanasDe(dias);

  if (querFalta) {
    const fl: LinhaConta[] = dias.filter((d) => d.faltaMin > 0).map((d) => ({
      op: '+', rotulo: `${dia(d.data)} · falta`,
      detalhe: d.minutosTrabalhados === 0 ? `dia sem batida · carga ${hh(d.minutosContratados)}` : `${hh(d.minutosTrabalhados)} feitas de ${hh(d.minutosContratados)}`,
      valor: hh(d.faltaMin),
    }));
    linhas.push(...limitar(fl, '+', (n) => `Mais ${n} dias de falta`, (x) => hh(x.reduce((a, y) => a + parseHh(y.valor), 0))));
  }
  if (querAtraso) {
    const mesIni = ap.inicio;
    const al: LinhaConta[] = dias.filter((d) => d.atrasoMin > 0).map((d) => {
      const obsSemana = d.observacoes.find((o) => /^Semana .*abaixo da carga/.test(o));
      if (!obsSemana || !d.semana) {
        return { op: '+' as const, rotulo: `${dia(d.data)} · atraso`, detalhe: `${hh(d.minutosTrabalhados)} feitas de ${hh(d.minutosContratados)}`, valor: hh(d.atrasoMin) };
      }
      const s = d.semana;
      const faltou = s.cargaMin - s.feitoMin;
      const viraramFalta = dias.filter((x) => x.semana?.inicio === s.inicio).reduce((a, x) => a + x.faltaMin, 0);
      const antes = s.inicio < mesIni;
      const partes = [`${hh(s.feitoMin)} feitas de ${hh(s.cargaMin)}: faltaram ${hh(faltou)}`];
      if (viraramFalta > 0) partes.push(`${hh(viraramFalta)} viraram falta nos dias sem batida deste mês`);
      partes.push(antes
        ? `o resto (${hh(d.atrasoMin)}) é dos dias do mês anterior, que fecham aqui porque a semana termina neste mês`
        : `o resto (${hh(d.atrasoMin)}) não chega a um dia inteiro`);
      return { op: '+' as const, rotulo: `Semana ${curto(s.inicio)}–${curto(s.fim)} · horas faltando`, detalhe: partes.join('; '), valor: hh(d.atrasoMin) };
    });
    linhas.push(...limitar(al, '+', (n) => `Mais ${n} dias de atraso`, (x) => hh(x.reduce((a, y) => a + parseHh(y.valor), 0))));
  }
  const total = (querFalta ? r.totalFaltaMin : 0) + (querAtraso ? r.totalAtrasoMin : 0);
  const nFaltas = dias.filter((d) => d.faltaMin > 0).length;
  const titulo = campo === 'atrasos' ? `Por que ${hh(total)} de atraso?`
    : campo === 'faltas' ? `Por que ${hh(total)} de falta?` : `Por que −${hh(total)} de atrasos e faltas?`;
  const dest = ap.destinacao;
  linhas.push({
    op: '=', rotulo: campo === 'atrasos' ? 'Atrasos do mês' : campo === 'faltas' ? `Faltas do mês · ${nFaltas} ${nFaltas === 1 ? 'dia' : 'dias'}` : 'Atrasos e faltas do mês',
    detalhe: dest ? `falta ${dest.falta.destino === 'DESCONTA' ? 'desconta na folha' : dest.falta.destino === 'BANCO' ? 'sai do banco' : 'abonada'} · atraso ${dest.atraso.destino === 'DESCONTA' ? 'desconta na folha' : dest.atraso.destino === 'BANCO' ? 'sai do banco' : 'tolerado'}` : undefined,
    valor: hh(total), estilo: 'total',
  });
  const partes: string[] = [];
  if (semanas.length) partes.push('A escala compensa na semana: o dia sem batida só vira falta se a semana inteira não fechar a carga. Quando falta um dia inteiro, o dia sem batida mais antigo vira falta; o que sobra, menor que um dia, aparece como atraso da semana.');
  else partes.push('Dia de trabalho sem batida vira falta com a carga daquele dia; chegar depois ou sair antes da escala, além da tolerância, vira atraso.');
  if (querFalta && nFaltas > 1) {
    const cargas = new Map<number, number>();
    for (const d of dias.filter((x) => x.faltaMin > 0)) cargas.set(d.faltaMin, (cargas.get(d.faltaMin) ?? 0) + 1);
    if (cargas.size > 1) partes.push(`As ${nFaltas} faltas somam ${[...cargas].map(([m, n]) => `${n} × ${hh(m)}`).join(' + ')}: os dias têm cargas diferentes.`);
  }
  const nota = r.dsrPerdidoSemanas > 0 && querFalta ? `Falta sem justificativa também tira o descanso remunerado (DSR) da semana: ${r.dsrPerdidoSemanas} ${r.dsrPerdidoSemanas === 1 ? 'semana' : 'semanas'} neste mês.` : undefined;
  return { titulo, resumo: partes.join(' '), linhas: linhas.length > 1 ? linhas : [{ op: '', rotulo: 'Nenhum dia com falta ou atraso', valor: '0h00', estilo: 'zero' }, ...linhas], nota, regras: regrasDe(ap) };
}

function explicarSaldo(ap: ApuracaoResp): Explicacao {
  const dias = ap.resultado.dias;
  const mais = dias.filter((d) => d.saldoMin > 0);
  const menos = dias.filter((d) => d.saldoMin < 0);
  const somaMais = mais.reduce((a, d) => a + d.saldoMin, 0);
  const somaMenos = menos.reduce((a, d) => a + d.saldoMin, 0);
  const total = ap.resultado.saldoPeriodoMin;
  const linhas: LinhaConta[] = [
    { op: '+', rotulo: 'Horas a mais', detalhe: `${mais.length} ${mais.length === 1 ? 'dia' : 'dias'} acima da carga`, valor: `+${hh(somaMais)}`, estilo: somaMais ? undefined : 'zero' },
    { op: '−', rotulo: 'Horas a menos', detalhe: `${menos.length} ${menos.length === 1 ? 'dia' : 'dias'} abaixo da carga (atrasos e saídas cedo)`, valor: `−${hh(somaMenos)}`, estilo: somaMenos ? undefined : 'zero' },
  ];
  const faltaFora = ap.resultado.totalFaltaMin > 0 && ap.destinacao?.falta.destino !== 'BANCO';
  if (faltaFora) linhas.push({ op: '', rotulo: 'Faltas de dia inteiro', detalhe: ap.destinacao?.falta.destino === 'ABONA' ? 'abonadas: não entram no saldo' : 'descontadas na folha: não entram no saldo', valor: hh(ap.resultado.totalFaltaMin), estilo: 'zero' });
  linhas.push({ op: '=', rotulo: 'Saldo do mês', detalhe: ap.banco ? 'é o que o mês leva para o banco' : 'sem banco: extra é paga e atraso descontado', valor: sinal(total), estilo: 'total' });
  return {
    titulo: `Por que ${sinal(total)} de saldo no mês?`,
    resumo: 'O saldo do mês soma a diferença de cada dia entre o que foi feito e a carga da escala. Falta de dia inteiro fica de fora quando a regra manda descontar na folha.',
    linhas, regras: regrasDe(ap),
  };
}

function explicarBanco(ap: ApuracaoResp): Explicacao {
  const b = ap.banco;
  if (!b) {
    return { titulo: 'Sem banco de horas', resumo: 'A regra de cálculo deste funcionário não usa banco: extra é paga e atraso é descontado na folha.', linhas: [], regras: regrasDe(ap) };
  }
  const linhas: LinhaConta[] = [
    { op: '', rotulo: 'Saldo que veio do mês anterior', detalhe: 'fechado no banco', valor: sinal(b.saldoAnteriorMin) },
    { op: b.saldoMesMin < 0 ? '−' : '+', rotulo: 'Saldo deste mês', detalhe: b.fechada ? 'já lançado no banco' : 'apuração até hoje', valor: sinal(b.saldoMesMin) },
    { op: b.avulsoMin < 0 ? '−' : '+', rotulo: 'Folgas, pagamentos e ajustes', detalhe: 'lançados pelo RH no banco', valor: sinal(b.avulsoMin), estilo: b.avulsoMin ? undefined : 'zero' },
  ];
  if (b.acerto) {
    linhas.push({ op: '→', rotulo: b.acerto.acertoMin >= 0 ? 'Pago na folha' : 'Descontado na folha', detalhe: 'compensa no mês e paga a diferença', valor: sinal(b.acerto.acertoMin) });
    if (b.acerto.passaMin) linhas.push({ op: '→', rotulo: 'Passa para o mês seguinte', detalhe: 'devendo que não foi descontado', valor: sinal(b.acerto.passaMin) });
  }
  linhas.push({ op: '=', rotulo: 'Saldo do banco', detalhe: b.formaCalculo === 'INTRA_MES' ? 'depois do acerto do mês' : `vence em ${b.prazoMeses} meses a partir de cada lançamento`, valor: sinal(b.saldoAcumuladoMin), estilo: 'total' });
  return {
    titulo: `Por que ${sinal(b.saldoAcumuladoMin)} no banco?`,
    resumo: b.formaCalculo === 'INTRA_MES'
      ? 'A regra compensa no mês: horas a mais e a menos se anulam dentro do mês e a diferença é acertada na folha.'
      : 'A regra acumula no banco: o que sobra ou falta em cada mês passa para o seguinte, até virar folga ou ser pago.',
    linhas, nota: b.desatualizado ? 'O mês foi fechado com um valor diferente do que a apuração dá hoje (alguém mexeu no ponto depois). Refaça o fechamento do mês no Banco de horas.' : undefined,
    regras: regrasDe(ap),
  };
}

export function explicar(ap: ApuracaoResp, campo: CampoExplicavel): Explicacao {
  if (campo === 'extras') return explicarExtras(ap);
  if (campo === 'saldo') return explicarSaldo(ap);
  if (campo === 'banco') return explicarBanco(ap);
  return explicarFaltasAtrasos(ap, campo);
}
