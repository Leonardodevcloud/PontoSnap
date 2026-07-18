import ExcelJS from 'exceljs';

export interface LinhaImportada {
  cpf: string;
  nome: string;
  matricula?: string;
  pis?: string;
  pin?: string;
  salarioMensal?: number;
  email?: string;
}

export interface ErroLinha {
  /** Número da linha na planilha (1 = cabeçalho), para o RH achar no arquivo. */
  linha: number;
  cpf?: string;
  motivo: string;
}

export interface ResultadoParse {
  validas: LinhaImportada[];
  erros: ErroLinha[];
}

/** Só dígitos — remove ponto, traço, espaço que o RH costuma digitar. */
const soDigitos = (v: string) => v.replace(/\D/g, '');

/**
 * Mapeia o cabeçalho da planilha para os campos, tolerante a variação.
 * O RH pode renomear "E-mail" para "email" ou "CPF" para "cpf": normalizamos.
 */
function acharColunas(cabecalho: string[]): Record<string, number> {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const alvo: Record<string, string[]> = {
    cpf: ['cpf'],
    nome: ['nome', 'nome completo'],
    matricula: ['matricula'],
    pis: ['pis'],
    pin: ['pin', 'pin (4 a 8 digitos)'],
    salarioMensal: ['salario', 'salario mensal'],
    email: ['email', 'e-mail'],
  };
  const idx: Record<string, number> = {};
  cabecalho.forEach((col, i) => {
    const c = norm(col ?? '');
    for (const [campo, nomes] of Object.entries(alvo)) {
      if (nomes.some((n) => c === n || c.startsWith(n))) idx[campo] = i;
    }
  });
  return idx;
}

/** Valida e normaliza uma linha crua. Devolve a linha OK ou o motivo do erro. */
function validarLinha(
  celulas: (string | number | null | undefined)[],
  idx: Record<string, number>,
  numLinha: number,
): { ok: LinhaImportada } | { erro: ErroLinha } {
  const pega = (campo: string): string => {
    const i = idx[campo];
    if (i == null) return '';
    const v = celulas[i];
    return v == null ? '' : String(v).trim();
  };

  const cpf = soDigitos(pega('cpf'));
  const nome = pega('nome');

  if (!cpf && !nome) return { erro: { linha: numLinha, motivo: 'linha vazia' } };
  if (!/^\d{11}$/.test(cpf)) {
    return { erro: { linha: numLinha, cpf: cpf || undefined, motivo: 'CPF deve ter 11 dígitos' } };
  }
  if (nome.length < 2) {
    return { erro: { linha: numLinha, cpf, motivo: 'nome é obrigatório' } };
  }

  const pis = soDigitos(pega('pis'));
  if (pis && !/^\d{11}$/.test(pis)) {
    return { erro: { linha: numLinha, cpf, motivo: 'PIS deve ter 11 dígitos' } };
  }
  const pin = soDigitos(pega('pin'));
  if (pin && !/^\d{4,8}$/.test(pin)) {
    return { erro: { linha: numLinha, cpf, motivo: 'PIN deve ter de 4 a 8 dígitos' } };
  }
  const email = pega('email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { erro: { linha: numLinha, cpf, motivo: 'e-mail inválido' } };
  }
  const salarioRaw = pega('salarioMensal').replace(/\./g, '').replace(',', '.');
  let salarioMensal: number | undefined;
  if (salarioRaw) {
    const n = Number(salarioRaw);
    if (Number.isNaN(n) || n < 0) {
      return { erro: { linha: numLinha, cpf, motivo: 'salário inválido' } };
    }
    salarioMensal = n;
  }

  return {
    ok: {
      cpf, nome,
      matricula: pega('matricula') || undefined,
      pis: pis || undefined,
      pin: pin || undefined,
      email: email || undefined,
      salarioMensal,
    },
  };
}

/** Detecta duplicidade de CPF DENTRO do próprio arquivo. */
function marcarDuplicadosNoArquivo(r: ResultadoParse): ResultadoParse {
  const vistos = new Set<string>();
  const validas: LinhaImportada[] = [];
  const erros = [...r.erros];
  let linhaAtual = 2;
  for (const v of r.validas) {
    if (vistos.has(v.cpf)) {
      erros.push({ linha: linhaAtual, cpf: v.cpf, motivo: 'CPF repetido no arquivo' });
    } else {
      vistos.add(v.cpf);
      validas.push(v);
    }
    linhaAtual++;
  }
  return { validas, erros };
}

/** Lê CSV (separador , ou ;) do buffer. Tolerante a BOM e aspas simples. */
export function parseCsv(texto: string): ResultadoParse {
  const semBom = texto.replace(/^\uFEFF/, '');
  const linhas = semBom.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (linhas.length === 0) return { validas: [], erros: [] };

  // Detecta o separador pela primeira linha (Excel PT-BR usa ;).
  const sep = (linhas[0]!.match(/;/g)?.length ?? 0) >= (linhas[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  // Split que respeita aspas: "2.500,50" não se parte na vírgula interna.
  const parseLinha = (l: string): string[] => {
    const out: string[] = [];
    let atual = '', dentroAspas = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') {
        if (dentroAspas && l[i + 1] === '"') { atual += '"'; i++; } // aspas escapada
        else dentroAspas = !dentroAspas;
      } else if (ch === sep && !dentroAspas) {
        out.push(atual.trim()); atual = '';
      } else {
        atual += ch;
      }
    }
    out.push(atual.trim());
    return out;
  };

  const idx = acharColunas(parseLinha(linhas[0]!));
  const validas: LinhaImportada[] = [];
  const erros: ErroLinha[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const r = validarLinha(parseLinha(linhas[i]!), idx, i + 1);
    if ('ok' in r) validas.push(r.ok);
    else if (r.erro.motivo !== 'linha vazia') erros.push(r.erro);
  }
  return marcarDuplicadosNoArquivo({ validas, erros });
}

/** Lê XLSX do buffer (primeira aba). */
export async function parseXlsx(buffer: Buffer): Promise<ResultadoParse> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { validas: [], erros: [] };

  const linhas: (string | number | null | undefined)[][] = [];
  ws.eachRow((row) => {
    const vals: (string | number | null | undefined)[] = [];
    // exceljs indexa a partir de 1; a posição 0 vem vazia.
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const v = cell.value;
      // Célula de e-mail pode vir como objeto de hyperlink.
      vals[colNumber - 1] = v && typeof v === 'object' && 'text' in v ? (v as { text: string }).text : (v as string | number | null);
    });
    linhas.push(vals);
  });
  if (linhas.length === 0) return { validas: [], erros: [] };

  const idx = acharColunas((linhas[0]!).map((c) => String(c ?? '')));
  const validas: LinhaImportada[] = [];
  const erros: ErroLinha[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const r = validarLinha(linhas[i]!, idx, i + 1);
    if ('ok' in r) validas.push(r.ok);
    else if (r.erro.motivo !== 'linha vazia') erros.push(r.erro);
  }
  return marcarDuplicadosNoArquivo({ validas, erros });
}
