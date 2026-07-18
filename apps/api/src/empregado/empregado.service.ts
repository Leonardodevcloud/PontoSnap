import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { empregado, pontoHorarioContratual, usuario, comTenant, comoMaster, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
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
    const urlApp = process.env.APP_WEB_URL ?? 'https://ponto-snap-web.vercel.app';
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
    const rows = await comTenant(this.db, tenantId, (tx) =>
      tx.update(empregado).set({ ativo })
        .where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).returning());
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

  async definirSalario(tenantId: string, id: string, salarioMensal: number) {
    const rows = await comTenant(this.db, tenantId, (tx) =>
      tx.update(empregado).set({ salarioMensal: String(salarioMensal) })
        .where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).returning());
    if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
    return this.semSegredos(rows[0]);
  }
}
