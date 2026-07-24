import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { tenant, pontoRep, usuario, usuarioTenant, comoMaster, type Db } from '@ponto/db';
import { TipoIdentificador } from '@ponto/shared';
import { DB } from '../database/database.module';
import { hashSenha } from '../auth/senha';
import { randomBytes } from 'node:crypto';
import { EmailService } from '../email/email.service';
import { emailBoasVindasCliente } from '../email/templates';

/** Senha provisória legível: sem 0/O/1/l/I para não confundir na hora de digitar. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function senhaProvisoria(tam = 10): string {
  const bytes = randomBytes(tam);
  let out = '';
  for (const b of bytes) out += ALFABETO[b % ALFABETO.length];
  return out;
}

export interface CriarTenantParams {
  cnpj: string; razaoSocial: string; localPrestacao?: string; fuso?: string;
  /** Caminho A (cliente novo): cria o acesso e manda o e-mail de boas-vindas. */
  adminEmail?: string;
  adminNome?: string;
  /** Caminho B (outra empresa de um cliente que já existe): usa um acesso atual. */
  usuarioExistenteId?: string;
  perfilNaEmpresa?: 'ADMIN_CLIENTE' | 'RH';
}

@Injectable()
export class TenantService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly email: EmailService,
  ) {}

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
  /**
   * Cadastra a empresa. Dois caminhos, escolhidos aqui e não depois:
   *
   *  A) cliente novo → cria o acesso, gera a senha provisória e manda o e-mail
   *     de boas-vindas.
   *  B) outra empresa de um cliente que já existe → amarra a empresa nova a um
   *     acesso atual (sem e-mail nem senha nova). É o caso do cliente com
   *     vários CNPJs e uma pessoa só cuidando de todos.
   *
   * Nos dois casos a linha de vínculo é criada. Sem ela, ao ganhar a segunda
   * empresa o acesso perderia a primeira de vista.
   */
  async criar(p: CriarTenantParams) {
    const cfg = this.plataforma();
    const caminhoB = !!p.usuarioExistenteId;
    if (!caminhoB && !p.adminEmail) {
      throw new ConflictException('Informe o e-mail do responsável ou escolha um acesso que já existe.');
    }

    const resultado = await comoMaster(this.db, async (tx) => {
      if ((await tx.select().from(tenant).where(eq(tenant.cnpj, p.cnpj)).limit(1))[0]) {
        throw new ConflictException('Já existe cliente com este CNPJ');
      }

      let dono: { id: string; email: string; perfil: string };
      let senha: string | null = null;

      if (caminhoB) {
        const u = (await tx.select({ id: usuario.id, email: usuario.email, perfil: usuario.perfil, tenantId: usuario.tenantId })
          .from(usuario).where(eq(usuario.id, p.usuarioExistenteId!)).limit(1))[0];
        if (!u) throw new NotFoundException('Acesso não encontrado');
        if (u.perfil !== 'ADMIN_CLIENTE' && u.perfil !== 'RH') {
          throw new ConflictException('Só contas de administração (Admin ou RH) podem administrar outra empresa.');
        }
        dono = { id: u.id, email: u.email, perfil: u.perfil };
        // Conserta quem foi criado antes do multi-empresa: garante o vínculo da
        // empresa de origem antes de somar a nova.
        if (u.tenantId) await this.garantirVinculo(tx, u.id, u.tenantId, u.perfil as 'ADMIN_CLIENTE' | 'RH');
      } else {
        if ((await tx.select().from(usuario).where(eq(usuario.email, p.adminEmail!)).limit(1))[0]) {
          throw new ConflictException('Este e-mail já tem acesso. Use o caminho "outra empresa de um cliente meu".');
        }
        senha = senhaProvisoria();
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

      if (!caminhoB) {
        const senhaHash = await hashSenha(senha!);
        const u = (await tx.insert(usuario).values({
          tenantId: t.id, email: p.adminEmail!, senhaHash, perfil: 'ADMIN_CLIENTE', deveTrocarSenha: true,
        }).returning())[0]!;
        dono = { id: u.id, email: u.email, perfil: u.perfil };
      }

      const perfilAqui = caminhoB ? (p.perfilNaEmpresa ?? 'RH') : 'ADMIN_CLIENTE';
      await this.garantirVinculo(tx, dono!.id, t.id, perfilAqui);

      return { tenant: t, repId: rep.id, admin: dono!, senhaProvisoria: senha, caminhoB };
    });

    // E-mail fora da transação: falha de envio não pode desfazer o cadastro.
    let emailEnviado = false;
    if (resultado.senhaProvisoria) {
      const url = process.env.APP_WEB_URL ?? 'https://pontosnap.online';
      const msg = emailBoasVindasCliente(p.adminNome ?? '', p.razaoSocial, resultado.admin.email, resultado.senhaProvisoria, url);
      emailEnviado = await this.email.enviar({ para: resultado.admin.email, ...msg }).catch(() => false);
    }
    return { ...resultado, emailEnviado };
  }

  /** Cria o vínculo usuário↔empresa se ainda não existir (idempotente). */
  private async garantirVinculo(
    tx: Parameters<Parameters<typeof comoMaster>[1]>[0],
    usuarioId: string, tenantId: string, perfil: 'ADMIN_CLIENTE' | 'RH',
  ) {
    const ja = (await tx.select({ id: usuarioTenant.id }).from(usuarioTenant).where(and(
      eq(usuarioTenant.usuarioId, usuarioId), eq(usuarioTenant.tenantId, tenantId))).limit(1))[0];
    if (!ja) await tx.insert(usuarioTenant).values({ usuarioId, tenantId, perfil });
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
      // Traz o nome do cliente de origem: sem isso, a lista vira um monte de
      // e-mail solto e não dá para saber de quem é cada conta.
      const contas = await tx.select({
        id: usuario.id, email: usuario.email, perfil: usuario.perfil,
        tenantPadrao: usuario.tenantId, ativo: usuario.ativo,
        empresaOrigem: tenant.razaoSocial,
      }).from(usuario)
        .leftJoin(tenant, eq(tenant.id, usuario.tenantId))
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

      // Conserta acessos criados antes do multi-empresa: sem o vínculo da
      // empresa de origem, ela sumiria do seletor ao ganhar a segunda.
      const orig = (await tx.select({ tenantId: usuario.tenantId }).from(usuario)
        .where(eq(usuario.id, usuarioId)).limit(1))[0];
      // (se a empresa sendo vinculada JÁ É a de origem, não há o que consertar —
      // e inserir aqui duplicaria o insert logo abaixo)
      if (orig?.tenantId && orig.tenantId !== tenantId) {
        await this.garantirVinculo(tx, usuarioId, orig.tenantId, u.perfil as 'ADMIN_CLIENTE' | 'RH');
      }

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
