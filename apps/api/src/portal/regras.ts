import type { ConferenciaNota, LinhaDetalheNota } from '@ponto/db';
import type { LinhaDebito, LinhaMei, LinhaMot, SemanaMot } from '../pessoal/pessoal.service';
import type { LidoNfse } from '@ponto/shared';

/**
 * Regras puras do portal do prestador: rótulos, "como chegou nesse valor",
 * situação da nota e conferência automática. Sem banco — testadas à parte.
 */

export type StatusNota = 'AGUARDANDO' | 'ENVIADA' | 'APROVADA' | 'RECUSADA';
/** Situação de uma nota (mês do MEI ou semana do motorista) na visão do RH. */
export type Situacao = 'NAO_LIBERADO' | 'FALTA' | 'CONFERIR' | 'RECUSADA' | 'CONTESTOU' | 'APROVADA' | 'RH';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const p2 = (n: number) => String(n).padStart(2, '0');

export const nomeMes = (comp: string) => MESES[Number(comp.slice(5, 7)) - 1] ?? comp;
/** "2026-10" → "Outubro/2026". */
export const rotuloMes = (comp: string) => { const m = nomeMes(comp); return `${m[0]!.toUpperCase()}${m.slice(1)}/${comp.slice(0, 4)}`; };
/** "2026-10-27" → "27/10". */
export const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** "2026-11-05" → "05/11/2026". */
export const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Fim da semana (domingo) a partir do início (segunda), em YYYY-MM-DD. */
export function fimDaSemana(inicio: string): string {
  const d = new Date(`${inicio}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

export function rotuloPeriodo(competencia: string, periodo: string, fim?: string | null): string {
  if (periodo === 'MES') return rotuloMes(competencia);
  return `Semana ${diaMes(periodo)} a ${diaMes(fim ?? fimDaSemana(periodo))}`;
}

export const reaisBr = (cent: number) =>
  (cent / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function horas(min: number) {
  const h = Math.floor(min / 60); const m = min % 60;
  return m ? `${h}h${p2(m)}` : `${h}h`;
}
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

/** Débitos do prestador no mês, um por linha ("Adiantamento (parcela 2/4)"). */
function linhasDebito(debitos: LinhaDebito[], pessoaId: string): LinhaDetalheNota[] {
  return debitos.filter((d) => d.pessoaId === pessoaId && d.parcelaCent > 0).map((d) => ({
    rotulo: d.tipo === 'FIXO' || d.parcelas <= 1 ? d.descricao : `${d.descricao} (parcela ${d.parcelaAtual}/${d.parcelas})`,
    valorCent: d.parcelaCent, tipo: 'MENOS' as const,
  }));
}

/**
 * Como chegou no valor do MEI: contrato + extras − faltas − débitos. A soma
 * das linhas fecha com o líquido (a diferença de arredondamento, se houver,
 * vai numa linha de ajuste para o prestador nunca ver conta que não bate).
 */
export function detalheMei(m: LinhaMei, debitos: LinhaDebito[], competencia: string): LinhaDetalheNota[] {
  const l: LinhaDetalheNota[] = [{ rotulo: 'Contrato mensal', valorCent: m.valorCent, tipo: 'BASE' }];
  if (m.heCent) l.push({ rotulo: `Horas extras (${horas(m.lanc.heMin)})`, valorCent: m.heCent, tipo: 'MAIS' });
  if (m.feriadosCent) l.push({ rotulo: `Feriados trabalhados (${m.lanc.feriadosTrab})`, valorCent: m.feriadosCent, tipo: 'MAIS' });
  if (m.lanc.metaCent) l.push({ rotulo: `Meta de ${nomeMes(competencia)}`, valorCent: m.lanc.metaCent, tipo: 'MAIS' });
  if (m.faltasCent) l.push({ rotulo: plural(m.lanc.faltas, 'falta', 'faltas'), valorCent: m.faltasCent, tipo: 'MENOS' });
  const debs = linhasDebito(debitos, m.id);
  const somaDebs = debs.reduce((a, d) => a + d.valorCent, 0);
  l.push(...debs);
  if (m.debitosCent - somaDebs > 0) l.push({ rotulo: 'Outros descontos', valorCent: m.debitosCent - somaDebs, tipo: 'MENOS' });
  if (m.metaDescontadaCent) l.push({ rotulo: 'Meta já paga antes', valorCent: m.metaDescontadaCent, tipo: 'MENOS' });
  return fechar(l, m.liquidoCent);
}

/** Semana do motorista: dias × diária + adicional − débito descontado na semana. */
export function detalheSemana(m: LinhaMot, s: SemanaMot): LinhaDetalheNota[] {
  const l: LinhaDetalheNota[] = [{
    rotulo: `${plural(s.dias, 'dia', 'dias')} × R$ ${reaisBr(m.diariaCent)}`, valorCent: s.totalCent - s.adicionalCent, tipo: 'BASE',
  }];
  if (s.adicionalCent) l.push({ rotulo: 'Adicional da semana', valorCent: s.adicionalCent, tipo: 'MAIS' });
  if (s.debitoAplicadoCent) l.push({ rotulo: 'Débito descontado nesta semana', valorCent: s.debitoAplicadoCent, tipo: 'MENOS' });
  return fechar(l, valorSemana(s));
}

export const valorSemana = (s: SemanaMot) => s.totalCent - s.debitoAplicadoCent;

function fechar(l: LinhaDetalheNota[], total: number): LinhaDetalheNota[] {
  const soma = l.reduce((a, x) => a + (x.tipo === 'MENOS' ? -x.valorCent : x.valorCent), 0);
  const dif = total - soma;
  if (dif !== 0) l.push({ rotulo: 'Ajuste de arredondamento', valorCent: Math.abs(dif), tipo: dif > 0 ? 'MAIS' : 'MENOS' });
  return l;
}

/**
 * Situação para o RH. Contestação sem resposta vem antes de tudo; nota que o
 * RH subiu pelo painel (sem passar pelo portal) conta como recebida.
 */
export function situacaoDe(nota: { status: string; confirmacao: string | null; resposta: string | null } | null, temNfDoRh: boolean): Situacao {
  if (!nota) return temNfDoRh ? 'RH' : 'NAO_LIBERADO';
  if (nota.confirmacao === 'CONTESTOU' && !nota.resposta && nota.status !== 'APROVADA') return 'CONTESTOU';
  switch (nota.status as StatusNota) {
    case 'ENVIADA': return 'CONFERIR';
    case 'APROVADA': return 'APROVADA';
    case 'RECUSADA': return 'RECUSADA';
    default: return temNfDoRh ? 'RH' : 'FALTA';
  }
}

/** Ordem de urgência (o motorista tem várias semanas; a linha mostra a mais urgente). */
const URGENCIA: Situacao[] = ['CONTESTOU', 'CONFERIR', 'RECUSADA', 'FALTA', 'NAO_LIBERADO', 'RH', 'APROVADA'];
export function maisUrgente(s: Situacao[]): Situacao {
  if (!s.length) return 'NAO_LIBERADO';
  return [...s].sort((a, b) => URGENCIA.indexOf(a) - URGENCIA.indexOf(b))[0]!;
}

// Leitura da NFS-e em XML: compartilhada com o app (que pré-preenche número/data/valor).
export { lerNfseXml, type LidoNfse } from '@ponto/shared';

/**
 * Conferência automática. Com XML, os dados vêm da própria nota; com PDF ou
 * foto, vêm do que o prestador informou (número, data e valor). "bate" só é
 * verdadeiro quando nada falhou e o arquivo não é foto (foto o RH olha).
 */
export function conferir(e: {
  mime: string; esperadoCent: number; competencia: string; periodo: string;
  informado: { numero: string; data: string; valorCent: number | null };
  lido: LidoNfse | null;
  documentoPrestador: string | null; cnpjTomador: string | null;
  numerosAnteriores: string[];
}): ConferenciaNota {
  const arquivo: ConferenciaNota['arquivo'] = e.mime.includes('xml') ? 'XML' : e.mime === 'application/pdf' ? 'PDF' : 'FOTO';
  const lido = e.lido;
  const numero = (lido?.numero ?? e.informado.numero).replace(/^0+(?=\d)/, '');
  const data = lido?.data ?? e.informado.data;
  const valor = lido?.valorCent ?? e.informado.valorCent;
  const valorBate = valor == null ? null : valor === e.esperadoCent;
  const numeroRepetido = e.numerosAnteriores.map((n) => n.replace(/^0+(?=\d)/, '')).includes(numero);
  // A nota é emitida depois do serviço: no mês do MEI (ou depois); na semana do motorista (ou depois).
  const inicio = e.periodo === 'MES' ? `${e.competencia}-01` : e.periodo;
  const competenciaOk = data ? data >= inicio : null;
  const tomadorOk = lido?.cnpjTomador && e.cnpjTomador ? lido.cnpjTomador === e.cnpjTomador : null;
  const prestadorOk = lido?.cnpjPrestador && e.documentoPrestador ? lido.cnpjPrestador === e.documentoPrestador : null;
  const falhou = valorBate === false || numeroRepetido || competenciaOk === false || tomadorOk === false || prestadorOk === false;
  return {
    arquivo, origem: lido ? 'XML' : 'INFORMADO', valorBate, numeroRepetido, competenciaOk, tomadorOk, prestadorOk,
    lido: lido ? { numero: lido.numero, data: lido.data, valorCent: lido.valorCent, cnpjTomador: lido.cnpjTomador, cnpjPrestador: lido.cnpjPrestador } : undefined,
    bate: !falhou && arquivo !== 'FOTO' && valorBate === true,
  };
}

/** Código do convite: 6 caracteres sem ambiguidade (sem 0/O, 1/I/L), mostrado como XXXX-XX. */
export function gerarCodigo(aleatorio: (n: number) => Buffer): string {
  const alfa = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = aleatorio(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += alfa[b[i]! % alfa.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Mensagem pronta para o WhatsApp. */
export function mensagemConvite(nome: string, empresa: string, link: string, tipoDoc: 'CPF' | 'CNPJ'): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? nome;
  return `Oi, ${primeiro}! Aqui é o RH da ${empresa}. Agora você vê seus valores e manda sua nota fiscal pelo app PontoSnap.\n\n📲 Crie seu acesso: ${link}\n\nSeu usuário é o seu ${tipoDoc}.`;
}

/** Celular BR só com dígitos → link do WhatsApp (null se não parece celular). */
export function linkWhatsapp(telefone: string | null, texto: string): string | null {
  const d = (telefone ?? '').replace(/\D/g, '');
  const num = d.length === 10 || d.length === 11 ? `55${d}` : d.length === 12 || d.length === 13 ? d : null;
  return num ? `https://wa.me/${num}?text=${encodeURIComponent(texto)}` : null;
}

/** Chave Pix com o meio escondido ("j•••@gmail.com", "•••.456.789-••"). */
export function mascararPix(chave: string | null): string | null {
  if (!chave) return null;
  const c = chave.trim();
  if (c.includes('@')) { const [u, dom] = c.split('@'); return `${u!.slice(0, 1)}•••@${dom}`; }
  if (c.length <= 6) return c;
  return `•••${c.slice(-4)}`;
}
