import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNotNull, lte, notInArray, or } from 'drizzle-orm';
import { auditoria, tenant, usuario, usuarioTenant, empregado, pessoalPrestador, comTenant, comoMaster, type Db } from '@ponto/db';
import { inicioDoDia, fimDoDia } from '@ponto/rep-core';
import { DB } from '../database/database.module';
import { nomeDoEmail } from '../usuarios/usuarios.service';

@Injectable()
export class AuditoriaService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Trilha do próprio cliente, filtrável por usuário e por período. */
  async listar(tenantId: string, f: { usuarioId?: string; outros?: boolean; inicio?: string; fim?: string; limite?: number }) {
    const limite = Math.min(f.limite ?? 100, 500);
    return comTenant(this.db, tenantId, async (tx) => {
      const fuso = (await tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0]?.fuso ?? '-0300';
      const conds = [eq(auditoria.tenantId, tenantId)];
      if (f.usuarioId) conds.push(eq(auditoria.usuarioId, f.usuarioId));
      // "Funcionários e prestadores": tudo o que não é da equipe (Admin/RH).
      if (f.outros) conds.push(inArray(auditoria.usuarioPerfil, ['COLABORADOR', 'PRESTADOR']));
      if (f.inicio) conds.push(gte(auditoria.em, inicioDoDia(f.inicio, fuso)));
      if (f.fim) conds.push(lte(auditoria.em, fimDoDia(f.fim, fuso)));
      return tx.select({
        id: auditoria.id, usuarioId: auditoria.usuarioId, usuarioEmail: auditoria.usuarioEmail, usuarioPerfil: auditoria.usuarioPerfil,
        acao: auditoria.acao, detalhe: auditoria.detalhe, statusHttp: auditoria.statusHttp,
        ip: auditoria.ip, em: auditoria.em,
      }).from(auditoria).where(and(...conds)).orderBy(desc(auditoria.em)).limit(limite);
    }).then(async (linhas) => {
      // Nome de quem fez (o atual da conta; contas sem nome usam o e-mail).
      const nomes = await this.nomes([...new Set(linhas.map((l) => l.usuarioId).filter((x): x is string => !!x))]);
      return linhas.map((l) => ({ ...l, usuarioNome: (l.usuarioId && nomes.get(l.usuarioId)) || null }));
    });
  }

  /** Nome de cada conta: o da conta; funcionário e prestador, o do cadastro (o e-mail deles é técnico). */
  private async nomes(ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const r = await comoMaster(this.db, (tx) => tx.select({
      id: usuario.id, nome: usuario.nome, email: usuario.email, emp: empregado.nome, prest: pessoalPrestador.nome,
    }).from(usuario)
      .leftJoin(empregado, eq(empregado.id, usuario.empregadoId))
      .leftJoin(pessoalPrestador, eq(pessoalPrestador.id, usuario.prestadorId))
      .where(inArray(usuario.id, ids)));
    return new Map(r.map((u) => [u.id, u.nome ?? u.emp ?? u.prest ?? nomeDoEmail(u.email)]));
  }

  /**
   * Quem é da equipe da empresa (Admin/RH, inclusive desativados) e quantas
   * ações cada um fez no período — para o filtro "Pessoa" da auditoria.
   */
  async pessoas(tenantId: string, f: { inicio?: string; fim?: string }) {
    const equipe = await comoMaster(this.db, (tx) => tx.select({ id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil, ativo: usuario.ativo })
      .from(usuario).where(and(inArray(usuario.perfil, ['ADMIN_CLIENTE', 'RH']), or(eq(usuario.tenantId, tenantId),
        inArray(usuario.id, tx.select({ id: usuarioTenant.usuarioId }).from(usuarioTenant).where(eq(usuarioTenant.tenantId, tenantId)))))));
    const contagem = await comTenant(this.db, tenantId, async (tx) => {
      const fuso = (await tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0]?.fuso ?? '-0300';
      const conds = [eq(auditoria.tenantId, tenantId), isNotNull(auditoria.usuarioId)];
      if (f.inicio) conds.push(gte(auditoria.em, inicioDoDia(f.inicio, fuso)));
      if (f.fim) conds.push(lte(auditoria.em, fimDoDia(f.fim, fuso)));
      return {
        equipe: await tx.select({ id: auditoria.usuarioId, n: count() }).from(auditoria)
          .where(and(...conds, notInArray(auditoria.usuarioPerfil, ['COLABORADOR', 'PRESTADOR']))).groupBy(auditoria.usuarioId),
        outros: Number((await tx.select({ n: count() }).from(auditoria).where(and(...conds, inArray(auditoria.usuarioPerfil, ['COLABORADOR', 'PRESTADOR']))))[0]?.n ?? 0),
      };
    });
    const n = new Map(contagem.equipe.map((c) => [c.id!, Number(c.n)]));
    // Quem foi da equipe e agiu, mas já não acessa a empresa, também aparece (marcado "saiu").
    const fora = [...n.keys()].filter((id) => !equipe.some((e) => e.id === id));
    const nomesFora = await this.nomes(fora);
    return {
      pessoas: [
        ...equipe.map((e) => ({ id: e.id, nome: e.nome ?? nomeDoEmail(e.email), email: e.email, ativo: e.ativo, saiu: false, acoes: n.get(e.id) ?? 0 })),
        ...fora.map((id) => ({ id, nome: nomesFora.get(id) ?? '—', email: '', ativo: false, saiu: true, acoes: n.get(id) ?? 0 })),
      ].sort((a, b) => Number(a.saiu) - Number(b.saiu) || b.acoes - a.acoes || a.nome.localeCompare(b.nome, 'pt-BR')),
      /** Ações de funcionários e prestadores (app), juntas. */
      outros: contagem.outros,
    };
  }
}
