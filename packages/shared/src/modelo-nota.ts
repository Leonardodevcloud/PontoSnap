/**
 * Modelo de nota fiscal do prestador: o texto da descrição tem campos que
 * o sistema preenche no fechamento ({mes}, {dias}…). Usado pela API (ao
 * liberar o valor) e pela tela (prévia ao editar o modelo).
 */

export const CAMPOS_MODELO_NOTA = [
  { chave: 'mes', rotulo: 'mês', exemplo: 'Outubro' },
  { chave: 'ano', rotulo: 'ano', exemplo: '2026' },
  { chave: 'periodo', rotulo: 'período', exemplo: '12/10 a 18/10' },
  { chave: 'dias', rotulo: 'dias trabalhados', exemplo: '13/10 e 16/10' },
  { chave: 'semana', rotulo: 'semana', exemplo: '12/10 a 18/10' },
  { chave: 'nome', rotulo: 'nome', exemplo: 'Carlos Souza' },
  { chave: 'funcao', rotulo: 'função', exemplo: 'Motorista' },
  { chave: 'valor', rotulo: 'valor', exemplo: 'R$ 1.229,76' },
] as const;
export type CampoModeloNota = (typeof CAMPOS_MODELO_NOTA)[number]['chave'];

export interface ContextoNota {
  /** YYYY-MM */
  competencia: string;
  /** 'MES' ou o início da semana (YYYY-MM-DD). */
  periodo: string;
  /** Datas trabalhadas (YYYY-MM-DD), se marcadas. */
  dias?: string[] | null;
  nome: string; funcao?: string | null; valorCent: number;
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** Fim da semana do motorista: o domingo, recortado no último dia do mês (como as semanas do fechamento). */
export function fimSemanaNoMes(inicio: string): string {
  const w = new Date(`${inicio}T12:00:00Z`).getUTCDay();
  const domingo = somaDias(inicio, (7 - w) % 7);
  const [a, m] = [Number(inicio.slice(0, 4)), Number(inicio.slice(5, 7))];
  const ultimo = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return domingo < ultimo ? domingo : ultimo;
}
export const listaPt = (xs: string[]) => xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');

export function valoresCampos(c: ContextoNota): Record<CampoModeloNota, string> {
  const mesNome = MESES[Number(c.competencia.slice(5, 7)) - 1] ?? c.competencia;
  const semana = c.periodo === 'MES' ? '' : `${dm(c.periodo)} a ${dm(fimSemanaNoMes(c.periodo))}`;
  const periodo = c.periodo === 'MES' ? `${mesNome.toLowerCase()}/${c.competencia.slice(0, 4)}` : semana;
  const dias = (c.dias ?? []).filter(Boolean).sort();
  return {
    mes: mesNome, ano: c.competencia.slice(0, 4), periodo, semana,
    dias: dias.length ? listaPt(dias.map(dm)) : periodo,
    nome: c.nome, funcao: c.funcao?.trim() || '', valor: brl(c.valorCent),
  };
}

/** Troca {campo} pelo valor; campo desconhecido fica como está. */
export function montarDescricaoNota(modelo: string, c: ContextoNota): string {
  const v = valoresCampos(c);
  return modelo.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? v[k as CampoModeloNota] : m)).replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').trim();
}

/** Bloco de texto para copiar/mandar (igual ao que o RH mandava pelo WhatsApp). */
export interface InstrucoesNota {
  modeloId: string | null; modeloNome: string | null;
  tomador: { cnpj: string; razao: string; endereco: string | null; telefone: string | null; email: string | null };
  codigoServico: string | null; codigoDescricao: string | null;
  descricao: string; observacao: string | null; valorCent: number;
}
const fmtCnpj = (d: string) => d.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
export function textoInstrucoesNota(i: InstrucoesNota): string {
  const l: string[] = ['Informações para emitir a nota fiscal:', '', 'Informações do Tomador:'];
  l.push(`* CNPJ: ${fmtCnpj(i.tomador.cnpj)}`, `* Razão Social: ${i.tomador.razao}`);
  if (i.tomador.endereco) l.push(`* Endereço: ${i.tomador.endereco}`);
  if (i.tomador.telefone) l.push(`* Telefone: ${i.tomador.telefone}`);
  if (i.tomador.email) l.push(`* E-mail: ${i.tomador.email}`);
  l.push('', 'Informações para a nota:');
  if (i.codigoServico) l.push(`* CNAE: ${i.codigoServico}${i.codigoDescricao ? ` - ${i.codigoDescricao}` : ''}`);
  l.push(`* Valor: ${brl(i.valorCent)}`, `* Descrição da nota: ${i.descricao}`);
  if (i.observacao) l.push('', i.observacao);
  return l.join('\n');
}
