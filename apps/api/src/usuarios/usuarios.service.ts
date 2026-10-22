import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { tenant, usuario, usuarioTenant, comoMaster, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { hashSenha } from '../auth/senha';
import { senhaProvisoria } from '../tenant/tenant.service';
import { EmailService } from '../email/email.service';
import { emailAcessoEquipe } from '../email/templates';

export type Papel = 'ADMIN_CLIENTE' | 'RH';
const PAPEIS: Papel[] = ['ADMIN_CLIENTE', 'RH'];
type Tx = Parameters<Parameters<typeof comoMaster>[1]>[0];

/**
 * Quem está pedindo: o MASTER (qualquer empresa) ou o Admin do cliente, que
 * só mexe nas empresas em que ele mesmo é Admin.
 */
export type Escopo = { tipo: 'MASTER' } | { tipo: 'ADMIN'; usuarioId: string; empresas: string[] };

export interface DadosUsuario { nome: string; email: string; perfil: Papel; empresas?: string[]; enviar?: boolean }

/** "mariane.oliveira@x" → "Mariane Oliveira" (enquanto a conta não tem nome). */
export function nomeDoEmail(email: string): string {
  const base = email.split('@')[0] ?? email;
  return base.split(/[._-]+/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') || email;
}
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const urlApp = () => process.env.APP_WEB_URL ?? 'https://pontosnap.app.br';

/**
 * Vários usuários por empresa (Admin/RH): cada pessoa com o próprio login,
 * para a auditoria mostrar quem fez cada coisa. Ninguém é apagado — desativar
 * tira o acesso e mantém o nome no histórico.
 */
@Injectable()
export class UsuariosService {
  constructor(@Inject(DB) private readonly db: Db, private readonly emails: EmailService) {}

  /** Empresas em que o usuário é Admin (o que o Admin do cliente pode gerenciar). */
  async escopoAdmin(usuarioId: string, tenantAtual: string | null): Promise<Escopo> {
    const empresas = await comoMaster(this.db, async (tx) => {
      const acc = (await this.acessosDe(tx, [usuarioId])).get(usuarioId) ?? [];
      return acc.filter((a) => a.perfil === 'ADMIN_CLIENTE').map((a) => a.tenantId);
    });
    if (!tenantAtual || !empresas.includes(tenantAtual)) throw new ForbiddenException('Só o Admin da empresa gerencia os usuários.');
    return { tipo: 'ADMIN', usuarioId, empresas };
  }

  /**
   * Acesso de cada conta: os vínculos (multi-empresa) ou, para contas antigas
   * sem vínculo, a empresa e o papel da própria conta.
   */
  private async acessosDe(tx: Tx, ids: string[]) {
    const out = new Map<string, { tenantId: string; perfil: Papel; vinculoId: string | null }[]>();
    if (!ids.length) return out;
    const us = await tx.select({ id: usuario.id, tenantId: usuario.tenantId, perfil: usuario.perfil }).from(usuario).where(inArray(usuario.id, ids));
    const vs = await tx.select().from(usuarioTenant).where(inArray(usuarioTenant.usuarioId, ids));
    for (const u of us) {
      const meus = vs.filter((v) => v.usuarioId === u.id);
      out.set(u.id, meus.length
        ? meus.map((v) => ({ tenantId: v.tenantId, perfil: v.perfil as Papel, vinculoId: v.id }))
        : u.tenantId && PAPEIS.includes(u.perfil as Papel) ? [{ tenantId: u.tenantId, perfil: u.perfil as Papel, vinculoId: null }] : []);
    }
    return out;
  }

  /** Contas Admin/RH que acessam a empresa. */
  private async idsDaEmpresa(tx: Tx, tenantId: string) {
    const r = await tx.select({ id: usuario.id }).from(usuario).where(and(
      inArray(usuario.perfil, PAPEIS),
      or(eq(usuario.tenantId, tenantId), inArray(usuario.id, tx.select({ id: usuarioTenant.usuarioId }).from(usuarioTenant).where(eq(usuarioTenant.tenantId, tenantId)))),
    ));
    return r.map((x) => x.id);
  }

  private exigirEscopo(escopo: Escopo, tenantId: string) {
    if (escopo.tipo === 'ADMIN' && !escopo.empresas.includes(tenantId)) throw new ForbiddenException('Você não administra esta empresa.');
  }

  async listar(tenantId: string, escopo: Escopo) {
    this.exigirEscopo(escopo, tenantId);
    return comoMaster(this.db, async (tx) => {
      const emp = (await tx.select({ id: tenant.id, razao: tenant.razaoSocial, cnpj: tenant.cnpj }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
      if (!emp) throw new NotFoundException('Empresa não encontrada');
      const ids = await this.idsDaEmpresa(tx, tenantId);
      const acc = await this.acessosDe(tx, ids);
      const contas = ids.length ? await tx.select().from(usuario).where(inArray(usuario.id, ids)) : [];
      const todas = await tx.select({ id: tenant.id, razao: tenant.razaoSocial, cnpj: tenant.cnpj, ativo: tenant.ativo }).from(tenant).orderBy(asc(tenant.razaoSocial));
      const nomeEmp = new Map(todas.map((t) => [t.id, t]));

      const usuarios = contas.map((u) => {
        const a = acc.get(u.id) ?? [];
        const aqui = a.find((x) => x.tenantId === tenantId);
        return {
          id: u.id, nome: u.nome ?? nomeDoEmail(u.email), nomeDefinido: !!u.nome, email: u.email,
          perfil: (aqui?.perfil ?? u.perfil) as Papel, ativo: u.ativo,
          aguardandoPrimeiroAcesso: u.deveTrocarSenha,
          ultimoAcessoEm: u.ultimoAcessoEm?.toISOString() ?? null, criadoEm: u.criadoEm.toISOString(),
          empresaPadrao: u.tenantId,
          empresas: a.map((x) => ({ id: x.tenantId, razao: nomeEmp.get(x.tenantId)?.razao ?? '—', perfil: x.perfil }))
            .sort((x, y) => (x.id === tenantId ? -1 : y.id === tenantId ? 1 : x.razao.localeCompare(y.razao, 'pt-BR'))),
          voce: escopo.tipo === 'ADMIN' && escopo.usuarioId === u.id,
        };
      }).sort((x, y) => Number(y.ativo) - Number(x.ativo) || (x.perfil === y.perfil ? 0 : x.perfil === 'ADMIN_CLIENTE' ? -1 : 1) || x.nome.localeCompare(y.nome, 'pt-BR'));

      // Empresas que dá para marcar. "Grupo" = as que os Admins desta empresa já administram.
      const grupo = new Set(usuarios.filter((u) => u.perfil === 'ADMIN_CLIENTE').flatMap((u) => u.empresas.map((e) => e.id)));
      grupo.delete(tenantId);
      const permitidas = escopo.tipo === 'ADMIN' ? new Set(escopo.empresas) : null;
      const empresasPossiveis = todas
        .filter((t) => (permitidas ? permitidas.has(t.id) : t.ativo || t.id === tenantId))
        .map((t) => ({ id: t.id, razao: t.razao, cnpj: t.cnpj, grupo: grupo.has(t.id), estaEmpresa: t.id === tenantId }))
        .sort((a, b) => Number(b.estaEmpresa) - Number(a.estaEmpresa) || Number(b.grupo) - Number(a.grupo) || a.razao.localeCompare(b.razao, 'pt-BR'));
      return { empresa: emp, usuarios, empresasPossiveis };
    });
  }

  /** Quantos Admins ativos sobram na empresa sem esta conta. */
  private async outrosAdmins(tx: Tx, tenantId: string, semUsuarioId: string) {
    const ids = (await this.idsDaEmpresa(tx, tenantId)).filter((x) => x !== semUsuarioId);
    if (!ids.length) return 0;
    const ativos = new Set((await tx.select({ id: usuario.id }).from(usuario).where(and(inArray(usuario.id, ids), eq(usuario.ativo, true)))).map((x) => x.id));
    const acc = await this.acessosDe(tx, [...ativos]);
    return [...ativos].filter((id) => acc.get(id)?.some((a) => a.tenantId === tenantId && a.perfil === 'ADMIN_CLIENTE')).length;
  }

  private async contaDaEmpresa(tx: Tx, tenantId: string, usuarioId: string) {
    const u = (await tx.select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1))[0];
    if (!u || !PAPEIS.includes(u.perfil as Papel)) throw new NotFoundException('Usuário não encontrado');
    const acc = (await this.acessosDe(tx, [u.id])).get(u.id) ?? [];
    if (!acc.some((a) => a.tenantId === tenantId)) throw new NotFoundException('Este usuário não acessa esta empresa.');
    return { u, acc };
  }

  /** Conta antiga (sem vínculo): grava o vínculo da empresa dela antes de mexer. */
  private async normalizar(tx: Tx, u: typeof usuario.$inferSelect, acc: { tenantId: string; perfil: Papel; vinculoId: string | null }[]) {
    for (const a of acc) if (!a.vinculoId) await tx.insert(usuarioTenant).values({ usuarioId: u.id, tenantId: a.tenantId, perfil: a.perfil }).onConflictDoNothing();
  }

  private async validarEmpresas(tx: Tx, ids: string[], escopo: Escopo) {
    if (escopo.tipo === 'ADMIN' && ids.some((x) => !escopo.empresas.includes(x))) throw new ForbiddenException('Você só pode dar acesso às empresas que você administra.');
    const achou = ids.length ? await tx.select({ id: tenant.id }).from(tenant).where(inArray(tenant.id, ids)) : [];
    if (achou.length !== ids.length) throw new NotFoundException('Empresa não encontrada');
  }

  private async emailLivre(tx: Tx, email: string, semId?: string) {
    const j = (await tx.select({ id: usuario.id, perfil: usuario.perfil }).from(usuario).where(sql`lower(${usuario.email}) = ${email}`).limit(1))[0];
    if (j && j.id !== semId) {
      throw new ConflictException(PAPEIS.includes(j.perfil as Papel)
        ? 'Este e-mail já tem acesso ao PontoSnap (em outra empresa). Para ele ver esta empresa também, use o Editar dele lá ou a tela Acessos do Master.'
        : 'Este e-mail já é usado por outra conta (funcionário ou prestador).');
    }
  }

  async criar(tenantId: string, escopo: Escopo, d: DadosUsuario) {
    this.exigirEscopo(escopo, tenantId);
    const nome = d.nome?.trim(); const email = d.email?.trim().toLowerCase();
    if (!nome || nome.length < 2) throw new BadRequestException('Informe o nome.');
    if (!email || !emailOk(email)) throw new BadRequestException('E-mail inválido.');
    if (!PAPEIS.includes(d.perfil)) throw new BadRequestException('Papel inválido.');
    const empresas = [...new Set([tenantId, ...(d.empresas ?? [])])];
    const senha = senhaProvisoria();
    const r = await comoMaster(this.db, async (tx) => {
      await this.validarEmpresas(tx, empresas, escopo);
      await this.emailLivre(tx, email);
      const [u] = await tx.insert(usuario).values({ tenantId, email, nome: nome.slice(0, 120), perfil: d.perfil, senhaHash: await hashSenha(senha), deveTrocarSenha: true }).returning();
      for (const t of empresas) await tx.insert(usuarioTenant).values({ usuarioId: u!.id, tenantId: t, perfil: d.perfil }).onConflictDoNothing();
      const emp = (await tx.select({ razao: tenant.razaoSocial }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0]!;
      return { u: u!, razao: emp.razao };
    });
    let emailEnviado = false;
    if (d.enviar !== false) {
      emailEnviado = await this.emails.enviar({ para: email, ...emailAcessoEquipe(nome, r.razao, email, senha, urlApp(), d.perfil) }).catch(() => false);
    }
    return { id: r.u.id, email, emailEnviado, senhaProvisoria: emailEnviado ? null : senha };
  }

  async editar(tenantId: string, escopo: Escopo, usuarioId: string, d: { nome?: string; perfil?: Papel; empresas?: string[] }) {
    this.exigirEscopo(escopo, tenantId);
    const proprio = escopo.tipo === 'ADMIN' && escopo.usuarioId === usuarioId;
    return comoMaster(this.db, async (tx) => {
      const { u, acc } = await this.contaDaEmpresa(tx, tenantId, usuarioId);
      await this.normalizar(tx, u, acc);
      const aqui = acc.find((a) => a.tenantId === tenantId)!;
      if (d.nome !== undefined) {
        const nome = d.nome.trim();
        if (nome.length < 2) throw new BadRequestException('Informe o nome.');
        await tx.update(usuario).set({ nome: nome.slice(0, 120) }).where(eq(usuario.id, u.id));
      }
      if (d.perfil && d.perfil !== aqui.perfil) {
        if (!PAPEIS.includes(d.perfil)) throw new BadRequestException('Papel inválido.');
        if (proprio) throw new BadRequestException('Você não pode mudar o seu próprio papel. Peça a outro Admin.');
        if (aqui.perfil === 'ADMIN_CLIENTE' && (await this.outrosAdmins(tx, tenantId, u.id)) === 0) throw new ConflictException('Esta é a última pessoa Admin da empresa. Torne outra pessoa Admin antes.');
        await tx.update(usuarioTenant).set({ perfil: d.perfil }).where(and(eq(usuarioTenant.usuarioId, u.id), eq(usuarioTenant.tenantId, tenantId)));
        if (u.tenantId === tenantId) await tx.update(usuario).set({ perfil: d.perfil }).where(eq(usuario.id, u.id));
      }
      if (d.empresas) {
        const quero = new Set(d.empresas);
        const tem = new Set(acc.map((a) => a.tenantId));
        // O Admin do cliente só mexe nas empresas que ele administra; as outras ficam como estão.
        const mexe = (t: string) => escopo.tipo === 'MASTER' || escopo.empresas.includes(t);
        const add = [...quero].filter((t) => !tem.has(t));
        const rem = [...tem].filter((t) => !quero.has(t) && mexe(t));
        await this.validarEmpresas(tx, add, escopo);
        if (rem.includes(tenantId) && proprio) throw new BadRequestException('Você não pode tirar o seu próprio acesso a esta empresa.');
        for (const t of rem) {
          const papelLa = acc.find((a) => a.tenantId === t)!.perfil;
          if (papelLa === 'ADMIN_CLIENTE' && (await this.outrosAdmins(tx, t, u.id)) === 0) throw new ConflictException('Esta pessoa é a última Admin de uma das empresas. Torne outra pessoa Admin lá antes.');
        }
        if (tem.size - rem.length + add.length === 0) throw new BadRequestException('A pessoa precisa enxergar pelo menos uma empresa. Para tirar todo o acesso, desative.');
        const papelNovo = (d.perfil ?? aqui.perfil) as Papel;
        for (const t of add) await tx.insert(usuarioTenant).values({ usuarioId: u.id, tenantId: t, perfil: papelNovo }).onConflictDoNothing();
        if (rem.length) await tx.delete(usuarioTenant).where(and(eq(usuarioTenant.usuarioId, u.id), inArray(usuarioTenant.tenantId, rem)));
        // Empresa padrão (onde a sessão abre) saiu: passa para a primeira que sobrou.
        if (u.tenantId && rem.includes(u.tenantId)) {
          const sobra = (await tx.select().from(usuarioTenant).where(eq(usuarioTenant.usuarioId, u.id)).limit(1))[0]!;
          await tx.update(usuario).set({ tenantId: sobra.tenantId, perfil: sobra.perfil }).where(eq(usuario.id, u.id));
        }
      }
      return { ok: true };
    });
  }

  async senhaNova(tenantId: string, escopo: Escopo, usuarioId: string) {
    this.exigirEscopo(escopo, tenantId);
    const senha = senhaProvisoria();
    const r = await comoMaster(this.db, async (tx) => {
      const { u, acc } = await this.contaDaEmpresa(tx, tenantId, usuarioId);
      if (!u.ativo) throw new BadRequestException('Reative o acesso antes de gerar uma senha.');
      await tx.update(usuario).set({ senhaHash: await hashSenha(senha), deveTrocarSenha: true }).where(eq(usuario.id, u.id));
      const emp = (await tx.select({ razao: tenant.razaoSocial }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0]!;
      return { u, razao: emp.razao, perfil: acc.find((a) => a.tenantId === tenantId)!.perfil };
    });
    const nome = r.u.nome ?? nomeDoEmail(r.u.email);
    const emailEnviado = await this.emails.enviar({ para: r.u.email, ...emailAcessoEquipe(nome, r.razao, r.u.email, senha, urlApp(), r.perfil, !r.u.deveTrocarSenha) }).catch(() => false);
    return { email: r.u.email, emailEnviado, senhaProvisoria: escopo.tipo === 'MASTER' || !emailEnviado ? senha : null };
  }

  async trocarEmail(tenantId: string, escopo: Escopo, usuarioId: string, novo: string, reenviar: boolean) {
    this.exigirEscopo(escopo, tenantId);
    const email = novo?.trim().toLowerCase();
    if (!email || !emailOk(email)) throw new BadRequestException('E-mail inválido.');
    await comoMaster(this.db, async (tx) => {
      const { u } = await this.contaDaEmpresa(tx, tenantId, usuarioId);
      await this.emailLivre(tx, email, u.id);
      await tx.update(usuario).set({ email }).where(eq(usuario.id, u.id));
    });
    if (reenviar) return this.senhaNova(tenantId, escopo, usuarioId);
    return { email, emailEnviado: false, senhaProvisoria: null };
  }

  async ativo(tenantId: string, escopo: Escopo, usuarioId: string, ativo: boolean) {
    this.exigirEscopo(escopo, tenantId);
    if (!ativo && escopo.tipo === 'ADMIN' && escopo.usuarioId === usuarioId) throw new BadRequestException('Você não pode desativar o seu próprio acesso.');
    return comoMaster(this.db, async (tx) => {
      const { u, acc } = await this.contaDaEmpresa(tx, tenantId, usuarioId);
      if (!ativo) {
        for (const a of acc.filter((x) => x.perfil === 'ADMIN_CLIENTE')) {
          if ((await this.outrosAdmins(tx, a.tenantId, u.id)) === 0) throw new ConflictException('Esta é a última pessoa Admin ativa de uma empresa. Torne outra pessoa Admin antes de desativar.');
        }
      }
      await tx.update(usuario).set({ ativo }).where(eq(usuario.id, u.id));
      return { ativo, empresas: acc.length };
    });
  }
}
