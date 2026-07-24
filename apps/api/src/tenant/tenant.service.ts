import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { tenant, pontoRep, usuario, usuarioTenant, comoMaster, type Db } from '@ponto/db';
import { TipoIdentificador } from '@ponto/shared';
import { DB } from '../database/database.module';
import { hashSenha } from '../auth/senha';

export interface CriarTenantParams {
  cnpj: string; razaoSocial: string; localPrestacao?: string; fuso?: string;
  adminEmail: string; adminSenha: string;
}

@Injectable()
export class TenantService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Config da plataforma (o REP-P é do software; o INPI é único p/ todos). */
  private plataforma() {
    return {
      numeroInpi: process.env.PLATAFORMA_INPI ?? 'BR512024000000-0',
      tipoIdDesenvolvedor: Number(process.env.PLATAFORMA_TIPO_ID_DEV ?? '1'),
      documentoDesenvolvedor: process.env.PLATAFORMA_DOC_DEV ?? '00000000000000',
    };
  }

  /**
   * Cria o cliente e, junto, seu REP-P e o primeiro acesso (ADMIN_CLIENTE).
   * É o "criar acesso do cliente" — que depois criará os funcionários dele.
   */
  async criar(p: CriarTenantParams) {
    const cfg = this.plataforma();
    return comoMaster(this.db, async (tx) => {
      if ((await tx.select().from(tenant).where(eq(tenant.cnpj, p.cnpj)).limit(1))[0]) {
        throw new ConflictException('Já existe cliente com este CNPJ');
      }
      if ((await tx.select().from(usuario).where(eq(usuario.email, p.adminEmail)).limit(1))[0]) {
        throw new ConflictException('E-mail de admin já cadastrado');
      }

      const t = (await tx.insert(tenant).values({
        cnpj: p.cnpj, razaoSocial: p.razaoSocial, localPrestacao: p.localPrestacao ?? null,
        fuso: p.fuso ?? '-0300',
      }).returning())[0]!;

      const rep = (await tx.insert(pontoRep).values({
        tenantId: t.id, tipoIdEmpregador: TipoIdentificador.CNPJ, documentoEmpregador: p.cnpj,
        razaoSocial: p.razaoSocial, numeroInpi: cfg.numeroInpi,
        tipoIdDesenvolvedor: cfg.tipoIdDesenvolvedor, documentoDesenvolvedor: cfg.documentoDesenvolvedor,
      }).returning())[0]!;

      const senhaHash = await hashSenha(p.adminSenha);
      const u = (await tx.insert(usuario).values({
        tenantId: t.id, email: p.adminEmail, senhaHash, perfil: 'ADMIN_CLIENTE', deveTrocarSenha: true,
      }).returning())[0]!;

      return { tenant: t, repId: rep.id, admin: { id: u.id, email: u.email, perfil: u.perfil } };
    });
  }

  listar() {
    return comoMaster(this.db, (tx) => tx.select().from(tenant));
  }

  async obter(id: string) {
    const rows = await comoMaster(this.db, (tx) => tx.select().from(tenant).where(eq(tenant.id, id)).limit(1));
    if (!rows[0]) throw new NotFoundException('Cliente não encontrado');
    return rows[0];
  }

  async definirAtivo(id: string, ativo: boolean) {
    await comoMaster(this.db, (tx) => tx.update(tenant).set({ ativo }).where(eq(tenant.id, id)));
    return this.obter(id);
  }

  /**
   * Ajusta o fuso do tenant. Só afeta batidas FUTURAS: cada marcação grava o
   * fuso vigente no INSERT (ponto_marcacao.fuso), então o histórico e o hash
   * permanecem íntegros. Idealmente definido antes das primeiras batidas.
   */
  async definirFuso(id: string, fuso: string) {
    await comoMaster(this.db, (tx) => tx.update(tenant).set({ fuso }).where(eq(tenant.id, id)));
    return this.obter(id);
  }

  // ---- Acesso multi-empresa (só MASTER concede) ----

  /** Contas de administração (ADMIN/RH) e as empresas de cada uma. */
  async listarAcessos() {
    return comoMaster(this.db, async (tx) => {
      const contas = await tx.select({
        id: usuario.id, email: usuario.email, perfil: usuario.perfil,
        tenantPadrao: usuario.tenantId, ativo: usuario.ativo,
      }).from(usuario)
        .where(inArray(usuario.perfil, ['ADMIN_CLIENTE', 'RH']))
        .orderBy(asc(usuario.email));

      const vinculos = await tx.select({
        id: usuarioTenant.id, usuarioId: usuarioTenant.usuarioId, tenantId: usuarioTenant.tenantId,
        perfil: usuarioTenant.perfil, razaoSocial: tenant.razaoSocial, cnpj: tenant.cnpj,
      }).from(usuarioTenant).innerJoin(tenant, eq(tenant.id, usuarioTenant.tenantId));

      const por = new Map<string, typeof vinculos>();
      for (const v of vinculos) por.set(v.usuarioId, [...(por.get(v.usuarioId) ?? []), v]);
      return contas.map((c) => ({ ...c, empresas: por.get(c.id) ?? [] }));
    });
  }

  /** Dá a um acesso existente permissão em mais uma empresa. */
  async vincularEmpresa(usuarioId: string, tenantId: string, perfil: 'ADMIN_CLIENTE' | 'RH') {
    return comoMaster(this.db, async (tx) => {
      const u = (await tx.select({ perfil: usuario.perfil }).from(usuario)
        .where(eq(usuario.id, usuarioId)).limit(1))[0];
      if (!u) throw new NotFoundException('Usuário não encontrado');
      // Colaborador tem vínculo, CPF e registro fiscal numa CNPJ — não circula.
      if (u.perfil !== 'ADMIN_CLIENTE' && u.perfil !== 'RH') {
        throw new ConflictException('Só contas de administração (Admin ou RH) podem ver mais de uma empresa.');
      }
      const t = (await tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
      if (!t) throw new NotFoundException('Empresa não encontrada');

      const ja = (await tx.select({ id: usuarioTenant.id }).from(usuarioTenant).where(and(
        eq(usuarioTenant.usuarioId, usuarioId), eq(usuarioTenant.tenantId, tenantId))).limit(1))[0];
      if (ja) throw new ConflictException('Este acesso já administra essa empresa.');

      const [v] = await tx.insert(usuarioTenant).values({ usuarioId, tenantId, perfil }).returning();
      return v;
    });
  }

  /** Retira o acesso. Vale já na próxima renovação de sessão. */
  async desvincularEmpresa(vinculoId: string) {
    return comoMaster(this.db, async (tx) => {
      const v = (await tx.select().from(usuarioTenant).where(eq(usuarioTenant.id, vinculoId)).limit(1))[0];
      if (!v) throw new NotFoundException('Vínculo não encontrado');
      const restantes = await tx.select({ id: usuarioTenant.id }).from(usuarioTenant)
        .where(eq(usuarioTenant.usuarioId, v.usuarioId));
      if (restantes.length <= 1) throw new ConflictException('Este acesso ficaria sem nenhuma empresa. Inative o usuário se for esse o caso.');
      await tx.delete(usuarioTenant).where(eq(usuarioTenant.id, vinculoId));
      return { removido: true };
    });
  }
}
