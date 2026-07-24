import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { parseCsv, parseXlsx, type ErroLinha } from './importacao';
import { and, eq } from 'drizzle-orm';
import { empregado, pontoHorarioContratual, pontoConvencao, pontoRegraItem, usuario, comTenant, comoMaster, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { registrarEventoRep } from '../fiscal/evento-rep';
import { EmailService } from '../email/email.service';
import { emailAcessoFuncionario } from '../email/templates';
import { hashPin } from '../auth/pin';
import { hashSenha } from '../auth/senha';
import { randomBytes } from 'node:crypto';

export interface CriarEmpregadoParams {
  cpf: string; nome: string; matricula?: string; pin?: string; pis?: string; salarioMensal?: number;
  email?: string;
}

/** Senha provisória legível: sem 0/O/1/l/I para não confundir na hora de digitar. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function senhaProvisoria(tam = 10): string {
  const bytes = randomBytes(tam);
  let out = '';
  for (const b of bytes) out += ALFABETO[b % ALFABETO.length];
  return out;
}

type EmpregadoRow = typeof empregado.$inferSelect;

@Injectable()
export class EmpregadoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly email: EmailService,
  ) {}

  /** Remove campos sensíveis antes de devolver ao cliente. */
  private semSegredos(e: EmpregadoRow) {
    const { pinHash, ...resto } = e;
    return { ...resto, temPin: pinHash != null };
  }

  async criar(tenantId: string, p: CriarEmpregadoParams) {
    const criado = await comTenant(this.db, tenantId, async (tx) => {
      const dup = await tx.select().from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.cpf, p.cpf))).limit(1);
      if (dup[0]) throw new ConflictException('Já existe empregado com este CPF');

      const pinHash = p.pin ? await hashPin(p.pin) : null;
      const rows = await tx.insert(empregado).values({
        tenantId, cpf: p.cpf, nome: p.nome,
        matricula: p.matricula ?? null, pinHash, pis: p.pis ?? null,
        salarioMensal: p.salarioMensal != null ? String(p.salarioMensal) : null,
      }).returning();

      // Registro 5 do AFD: inclusão de empregado no REP.
      await registrarEventoRep(tx as never, tenantId, {
        tipo: 5, operacao: 'I', cpfEmpregado: p.cpf, nomeEmpregado: p.nome,
      });
      return this.semSegredos(rows[0]!);
    });

    // Acesso ao app é opcional: quem só bate no quiosque não precisa de login.
    if (p.email) {
      const acesso = await this.criarOuResetarAcesso(tenantId, criado.id, p.email);
      return { ...criado, acesso };
    }
    return criado;
  }

  /**
   * Cria (ou reseta) o login do colaborador. Devolve a senha provisória UMA vez —
   * ela não é recuperável depois, só resetável. O primeiro login exige troca.
   */
  async criarOuResetarAcesso(tenantId: string, empregadoId: string, email?: string) {
    const emp = (await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(empregado)
        .where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1)))[0];
    if (!emp) throw new NotFoundException('Empregado não encontrado');

    const senha = senhaProvisoria();
    const senhaHash = await hashSenha(senha);

    // O e-mail é único global (é a chave do login), então o lookup roda como MASTER —
    // igual ao login. A escrita continua carimbando o tenant do empregado.
    const resultado = await comoMaster(this.db, async (tx) => {
      const atual = (await tx.select().from(usuario)
        .where(eq(usuario.empregadoId, empregadoId)).limit(1))[0];

      if (atual) {
        await tx.update(usuario)
          .set({ senhaHash, deveTrocarSenha: true, ativo: true, ...(email ? { email } : {}) })
          .where(eq(usuario.id, atual.id));
        return { email: email ?? atual.email, senhaProvisoria: senha, resetado: true };
      }

      if (!email) throw new ConflictException('Informe o e-mail para criar o acesso');
      const emUso = (await tx.select().from(usuario).where(eq(usuario.email, email)).limit(1))[0];
      if (emUso) throw new ConflictException('Este e-mail já está em uso');

      await tx.insert(usuario).values({
        tenantId, email, senhaHash, perfil: 'COLABORADOR',
        empregadoId, deveTrocarSenha: true,
      });
      return { email, senhaProvisoria: senha, resetado: false };
    });

    // Manda a senha provisória por e-mail. Best-effort: se o envio falhar, o
    // acesso já foi criado e a senha volta na resposta da API do mesmo jeito.
    const urlApp = process.env.APP_WEB_URL ?? 'https://app.pontosnap.online';
    const { assunto, html } = emailAcessoFuncionario(emp.nome, resultado.email, senha, urlApp);
    await this.email.enviar({ para: resultado.email, assunto, html });

    return resultado;
  }

  /** Indica quais empregados já têm login (para a tela do RH). */
  async listarComAcesso(tenantId: string) {
    const emps = await this.listar(tenantId);
    const contas = await comoMaster(this.db, (tx) =>
      tx.select({ empregadoId: usuario.empregadoId, email: usuario.email })
        .from(usuario).where(eq(usuario.tenantId, tenantId)));
    const porEmpregado = new Map(contas.filter((c) => c.empregadoId).map((c) => [c.empregadoId!, c.email]));
    return emps.map((e) => ({ ...e, emailAcesso: porEmpregado.get(e.id) ?? null }));
  }

  async listar(tenantId: string) {
    const rows = await comTenant(this.db, tenantId, (tx) => tx.select().from(empregado));
    return rows.map((e) => this.semSegredos(e));
  }

  async obter(tenantId: string, id: string) {
    const rows = await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(empregado).where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).limit(1));
    if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
    return this.semSegredos(rows[0]);
  }

  /** Define/atualiza o PIN do quiosque (armazenado com hash). */
  async definirPin(tenantId: string, id: string, pin: string) {
    const pinHash = await hashPin(pin);
    const rows = await comTenant(this.db, tenantId, (tx) =>
      tx.update(empregado).set({ pinHash })
        .where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).returning());
    if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
    return { id, pinDefinido: true };
  }

  async definirAtivo(tenantId: string, id: string, ativo: boolean) {
    const rows = await comTenant(this.db, tenantId, async (tx) => {
      const r = await tx.update(empregado).set({ ativo })
        .where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).returning();
      if (r[0]) {
        // Registro 5 do AFD: reativar é alteração ("A"); inativar equivale à
        // exclusão do empregado no REP ("E") — ele deixa de bater ponto.
        await registrarEventoRep(tx as never, tenantId, {
          tipo: 5, operacao: ativo ? 'A' : 'E',
          cpfEmpregado: r[0].cpf, nomeEmpregado: r[0].nome,
        });
      }
      return r;
    });
    if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
    return this.semSegredos(rows[0]);
  }

  /** Vincula uma escala/horário contratual ao funcionário. */
  async definirHorario(tenantId: string, id: string, horarioContratualId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const hor = await tx.select().from(pontoHorarioContratual)
        .where(and(eq(pontoHorarioContratual.id, horarioContratualId), eq(pontoHorarioContratual.tenantId, tenantId))).limit(1);
      if (!hor[0]) throw new NotFoundException('Horário não encontrado');
      const rows = await tx.update(empregado).set({ horarioContratualId })
        .where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).returning();
      if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
      return this.semSegredos(rows[0]);
    });
  }

  /** Monta as regras do funcionário: grava os itens escolhidos (null = padrão). */
  async definirRegras(tenantId: string, id: string, ids: {
    regraExtraId?: string | null; regraToleranciaId?: string | null; regraNoturnoId?: string | null;
    regraJornadaId?: string | null; regraBancoId?: string | null; regraDestinacaoId?: string | null;
  }) {
    return comTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.update(empregado).set({
        regraExtraId: ids.regraExtraId ?? null, regraToleranciaId: ids.regraToleranciaId ?? null,
        regraNoturnoId: ids.regraNoturnoId ?? null, regraJornadaId: ids.regraJornadaId ?? null,
        regraBancoId: ids.regraBancoId ?? null, regraDestinacaoId: ids.regraDestinacaoId ?? null,
      }).where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).returning();
      if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
      return this.semSegredos(rows[0]);
    });
  }

  /** Atalho: aplica ao funcionário as peças que a IA gerou de uma convenção. */
  async aplicarConvencao(tenantId: string, id: string, convencaoId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const itens = await tx.select({ id: pontoRegraItem.id, tipo: pontoRegraItem.tipo }).from(pontoRegraItem)
        .where(and(eq(pontoRegraItem.tenantId, tenantId), eq(pontoRegraItem.convencaoId, convencaoId)));
      if (itens.length === 0) throw new NotFoundException('Esta convenção não gerou regras ainda. Use "gerar regra IA" na convenção.');
      const porTipo = new Map(itens.map((i) => [i.tipo, i.id]));
      const rows = await tx.update(empregado).set({
        regraExtraId: porTipo.get('EXTRA') ?? null, regraToleranciaId: porTipo.get('TOLERANCIA') ?? null,
        regraNoturnoId: porTipo.get('NOTURNO') ?? null, regraJornadaId: porTipo.get('JORNADA') ?? null,
        regraBancoId: porTipo.get('BANCO') ?? null, regraDestinacaoId: porTipo.get('DESTINACAO') ?? null,
        convencaoId,
      }).where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).returning();
      if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
      return this.semSegredos(rows[0]);
    });
  }

  /** Vincula o funcionário a uma convenção-documento (ou null). */
  async definirConvencao(tenantId: string, id: string, convencaoId: string | null) {
    return comTenant(this.db, tenantId, async (tx) => {
      if (convencaoId) {
        const c = await tx.select({ id: pontoConvencao.id }).from(pontoConvencao)
          .where(and(eq(pontoConvencao.id, convencaoId), eq(pontoConvencao.tenantId, tenantId))).limit(1);
        if (!c[0]) throw new NotFoundException('Convenção não encontrada');
      }
      const rows = await tx.update(empregado).set({ convencaoId })
        .where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).returning();
      if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
      return this.semSegredos(rows[0]);
    });
  }

  async definirSalario(tenantId: string, id: string, salarioMensal: number) {
    const rows = await comTenant(this.db, tenantId, (tx) =>
      tx.update(empregado).set({ salarioMensal: String(salarioMensal) })
        .where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).returning());
    if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
    return this.semSegredos(rows[0]);
  }

  /**
   * Importa funcionários de um .xlsx ou .csv.
   *
   * Reusa criar() linha a linha — assim cada funcionário passa pela MESMA
   * validação de negócio e dispara o mesmo e-mail de acesso quando tem e-mail.
   * Erros de parse (CPF inválido) e erros de criação (CPF já existe no banco)
   * são acumulados e devolvidos juntos: as linhas boas entram, o RH recebe a
   * lista do que falhou para corrigir e reenviar só isso.
   */
  async importarLote(tenantId: string, arquivo: Buffer, nomeArquivo: string) {
    const ehCsv = nomeArquivo.toLowerCase().endsWith('.csv');
    const parse = ehCsv ? parseCsv(arquivo.toString('utf8')) : await parseXlsx(arquivo);

    const erros: ErroLinha[] = [...parse.erros];
    let criados = 0;
    let comAcesso = 0;

    // Sequencial de propósito: cada criar() abre transação e pode mandar e-mail;
    // paralelizar aqui viraria tempestade de conexões e de envios.
    let linha = 2;
    for (const v of parse.validas) {
      try {
        const r = await this.criar(tenantId, v);
        criados++;
        if ('acesso' in r && r.acesso) comAcesso++;
      } catch (e) {
        const msg = e instanceof ConflictException ? 'CPF já cadastrado no sistema' : 'não foi possível cadastrar';
        erros.push({ linha, cpf: v.cpf, motivo: msg });
      }
      linha++;
    }

    return {
      criados,
      comAcesso,
      totalLinhas: parse.validas.length + parse.erros.length,
      erros,
    };
  }

  /** Monta o modelo .xlsx de importação, sempre em sincronia com os campos aceitos. */
  async gerarModeloImportacao(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Funcionários');

    const colunas = [
      { h: 'CPF', larg: 16, dica: 'Obrigatório. 11 dígitos, só números.' },
      { h: 'Nome completo', larg: 30, dica: 'Obrigatório.' },
      { h: 'Matrícula', larg: 14, dica: 'Opcional. Código interno.' },
      { h: 'PIS', larg: 16, dica: 'Opcional. 11 dígitos.' },
      { h: 'PIN (4 a 8 dígitos)', larg: 18, dica: 'Opcional. Senha do quiosque.' },
      { h: 'Salário mensal', larg: 16, dica: 'Opcional. Ex.: 2500.00' },
      { h: 'E-mail', larg: 28, dica: 'Opcional. Preenchido cria o acesso e envia a senha.' },
    ];
    const cab = ws.addRow(colunas.map((c) => c.h));
    cab.eachCell((cel, i) => {
      cel.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10403F' } };
      cel.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cel.note = colunas[i - 1]!.dica;
      ws.getColumn(i).width = colunas[i - 1]!.larg;
    });
    cab.height = 32;

    const ex = ws.addRow(['04561234567', 'Maria Aparecida Souza', 'F-1042', '12345678901', '4829', '2500.00', 'maria.souza@empresa.com.br']);
    ex.eachCell((cel) => { cel.font = { name: 'Arial', italic: true, color: { argb: 'FF9A8F86' }, size: 10 }; });

    // CPF e PIS como texto para não perder o zero da frente.
    ws.getColumn(1).numFmt = '@';
    ws.getColumn(4).numFmt = '@';
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const wi = wb.addWorksheet('Como preencher');
    wi.getColumn(1).width = 90;
    const inst = [
      'Como importar funcionários no PontoSnap',
      '',
      'Só CPF e Nome são obrigatórios. Apague a linha de exemplo antes de salvar.',
      'CPF e PIS: só números, mantenha os zeros da frente.',
      'E-mail preenchido cria o acesso ao app e envia a senha por e-mail; em branco, só cadastra.',
      'Salve como .xlsx ou .csv e envie na tela de importação.',
      'Linhas com erro são apontadas uma a uma — as válidas entram normalmente.',
    ];
    inst.forEach((t, i) => {
      const c = wi.getCell(i + 1, 1);
      c.value = t;
      c.font = i === 0 ? { name: 'Arial', bold: true, size: 15, color: { argb: 'FF10403F' } } : { name: 'Arial', size: 10.5 };
      c.alignment = { wrapText: true, vertical: 'top' };
    });

    return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  }
}
