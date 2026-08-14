import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { pontoPerfilRegra, empregado, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';

interface DadosPerfil {
  nome: string;
  config: Record<string, unknown>;
  padrao?: boolean;
  cctSindicato?: string; cctVigencia?: string; cctRegistroMte?: string;
  cctPdfNome?: string; cctPdfBase64?: string;
}

@Injectable()
export class PerfilRegraService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Lista os perfis, com quantos funcionários usam cada um. */
  async listar(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const perfis = await tx.select().from(pontoPerfilRegra)
        .where(eq(pontoPerfilRegra.tenantId, tenantId)).orderBy(asc(pontoPerfilRegra.nome));
      const emps = await tx.select({ perfilRegraId: empregado.perfilRegraId })
        .from(empregado).where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)));
      const uso = new Map<string, number>();
      for (const e of emps) if (e.perfilRegraId) uso.set(e.perfilRegraId, (uso.get(e.perfilRegraId) ?? 0) + 1);
      // o PDF é pesado — não vai na listagem
      return perfis.map(({ cctPdfBase64, ...p }) => ({ ...p, temPdf: !!cctPdfBase64, usadoPor: uso.get(p.id) ?? 0 }));
    });
  }

  async criar(tenantId: string, d: DadosPerfil) {
    return comTenant(this.db, tenantId, async (tx) => {
      if (d.padrao) {
        await tx.update(pontoPerfilRegra).set({ padrao: false }).where(eq(pontoPerfilRegra.tenantId, tenantId));
      }
      const [p] = await tx.insert(pontoPerfilRegra).values({
        tenantId, nome: d.nome, config: d.config, padrao: !!d.padrao,
        cctSindicato: d.cctSindicato ?? null, cctVigencia: d.cctVigencia ?? null,
        cctRegistroMte: d.cctRegistroMte ?? null,
        cctPdfNome: d.cctPdfNome ?? null, cctPdfBase64: d.cctPdfBase64 ?? null,
      }).returning();
      return p;
    });
  }

  async atualizar(tenantId: string, id: string, d: DadosPerfil) {
    return comTenant(this.db, tenantId, async (tx) => {
      if (d.padrao) {
        await tx.update(pontoPerfilRegra).set({ padrao: false })
          .where(and(eq(pontoPerfilRegra.tenantId, tenantId), ne(pontoPerfilRegra.id, id)));
      }
      const set: Record<string, unknown> = {
        nome: d.nome, config: d.config, padrao: !!d.padrao,
        cctSindicato: d.cctSindicato ?? null, cctVigencia: d.cctVigencia ?? null,
        cctRegistroMte: d.cctRegistroMte ?? null,
      };
      // só sobrescreve o PDF se veio um novo (undefined = mantém o atual)
      if (d.cctPdfBase64 !== undefined) { set.cctPdfNome = d.cctPdfNome ?? null; set.cctPdfBase64 = d.cctPdfBase64 ?? null; }
      const rows = await tx.update(pontoPerfilRegra).set(set)
        .where(and(eq(pontoPerfilRegra.id, id), eq(pontoPerfilRegra.tenantId, tenantId))).returning();
      if (!rows[0]) throw new NotFoundException('Perfil não encontrado');
      return rows[0];
    });
  }

  async remover(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const emUso = (await tx.select({ id: empregado.id }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.perfilRegraId, id))).limit(1))[0];
      if (emUso) throw new NotFoundException('Este perfil está em uso por funcionários. Troque-os de perfil antes de excluir.');
      await tx.delete(pontoPerfilRegra).where(and(eq(pontoPerfilRegra.id, id), eq(pontoPerfilRegra.tenantId, tenantId)));
      return { removido: true };
    });
  }

  /** Baixa o PDF da convenção anexada ao perfil. */
  async pdf(tenantId: string, id: string): Promise<{ nome: string; buffer: Buffer }> {
    return comTenant(this.db, tenantId, async (tx) => {
      const p = (await tx.select({ nome: pontoPerfilRegra.cctPdfNome, b64: pontoPerfilRegra.cctPdfBase64 })
        .from(pontoPerfilRegra).where(and(eq(pontoPerfilRegra.id, id), eq(pontoPerfilRegra.tenantId, tenantId))).limit(1))[0];
      if (!p?.b64) throw new NotFoundException('Este perfil não tem convenção anexada.');
      return { nome: p.nome ?? 'convencao.pdf', buffer: Buffer.from(p.b64, 'base64') };
    });
  }
}
