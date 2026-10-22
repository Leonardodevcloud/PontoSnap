import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { comTenant, pessoalModeloNota, pessoalPrestador, tenant, type Db, type InstrucoesNota } from '@ponto/db';
import { formatarCodigoServico, montarDescricaoNota } from '@ponto/shared';
import { DB } from '../database/database.module';

export type ModeloNota = typeof pessoalModeloNota.$inferSelect;
type Prestador = typeof pessoalPrestador.$inferSelect;
type Tx = Parameters<Parameters<typeof comTenant>[2]>[0];

export interface DadosModelo {
  nome: string; padraoTipo?: 'MEI' | 'MOTORISTA' | null;
  tomadorCnpj: string; tomadorRazao: string; tomadorEndereco?: string | null; tomadorTelefone?: string | null; tomadorEmail?: string | null;
  codigoServico?: string | null; codigoDescricao?: string | null; descricao: string; observacao?: string | null;
}

/** Modelo que vale para o prestador: o escolhido, senão o padrão do tipo dele. */
export function modeloDe(p: Pick<Prestador, 'modeloNotaId' | 'tipo'>, modelos: ModeloNota[]): ModeloNota | null {
  return (p.modeloNotaId ? modelos.find((m) => m.id === p.modeloNotaId) : undefined) ?? modelos.find((m) => m.padraoTipo === p.tipo) ?? null;
}

/** O que vai na nota de um período: tomador, código e a descrição já preenchida. */
export function instrucoesDe(m: ModeloNota, p: Pick<Prestador, 'nome' | 'funcao'>, n: { competencia: string; periodo: string; valorCent: number }, dias?: string[] | null): InstrucoesNota {
  return {
    modeloId: m.id, modeloNome: m.nome,
    tomador: { cnpj: m.tomadorCnpj, razao: m.tomadorRazao, endereco: m.tomadorEndereco, telefone: m.tomadorTelefone, email: m.tomadorEmail },
    codigoServico: m.codigoServico, codigoDescricao: m.codigoDescricao,
    descricao: montarDescricaoNota(m.descricao, { competencia: n.competencia, periodo: n.periodo, dias, nome: p.nome, funcao: p.funcao, valorCent: n.valorCent }),
    observacao: m.observacao, valorCent: n.valorCent,
  };
}

const limpo = (s: string | null | undefined, max: number) => (s?.trim() ? s.trim().slice(0, max) : null);

/**
 * Modelos de nota fiscal por operação (Motoristas, Operadores internos…):
 * configura uma vez, vale em todos os fechamentos.
 */
@Injectable()
export class ModeloNotaService {
  constructor(@Inject(DB) private readonly db: Db) {}

  listarTx(tx: Tx, tenantId: string) {
    return tx.select().from(pessoalModeloNota).where(eq(pessoalModeloNota.tenantId, tenantId));
  }

  async listar(tenantId: string) {
    const r = await comTenant(this.db, tenantId, async (tx) => ({
      modelos: await this.listarTx(tx, tenantId),
      pessoas: await tx.select({ id: pessoalPrestador.id, tipo: pessoalPrestador.tipo, modeloNotaId: pessoalPrestador.modeloNotaId, nome: pessoalPrestador.nome })
        .from(pessoalPrestador).where(eq(pessoalPrestador.tenantId, tenantId)),
      emp: (await tx.select({ razao: tenant.razaoSocial, cnpj: tenant.cnpj }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0],
    }));
    const usa = new Map<string, number>();
    const sem: { id: string; nome: string; tipo: string }[] = [];
    const pessoas: { id: string; nome: string; tipo: string; modeloNotaId: string | null; modeloEfetivoId: string | null }[] = [];
    for (const p of r.pessoas) {
      const m = modeloDe(p, r.modelos);
      pessoas.push({ id: p.id, nome: p.nome, tipo: p.tipo, modeloNotaId: p.modeloNotaId, modeloEfetivoId: m?.id ?? null });
      if (m) usa.set(m.id, (usa.get(m.id) ?? 0) + 1); else sem.push({ id: p.id, nome: p.nome, tipo: p.tipo });
    }
    return {
      modelos: r.modelos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((m) => ({ ...m, usadoPor: usa.get(m.id) ?? 0,
        escolhidoPor: r.pessoas.filter((p) => p.modeloNotaId === m.id).length })),
      semModelo: sem.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      pessoas: pessoas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      empresa: { razao: r.emp?.razao ?? '', cnpj: r.emp?.cnpj ?? '' },
    };
  }

  private validar(d: DadosModelo) {
    const cnpj = (d.tomadorCnpj ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) throw new BadRequestException('CNPJ do tomador inválido.');
    if (!d.nome?.trim()) throw new BadRequestException('Dê um nome ao modelo.');
    if (!d.tomadorRazao?.trim()) throw new BadRequestException('Informe a razão social do tomador.');
    if (!d.descricao?.trim()) throw new BadRequestException('Escreva a descrição da nota.');
    const cod = d.codigoServico?.trim() ? formatarCodigoServico(d.codigoServico) : null;
    if (d.codigoServico?.trim() && !cod) throw new BadRequestException('Código do serviço no formato 26.01.01.');
    return {
      nome: d.nome.trim().slice(0, 80), padraoTipo: d.padraoTipo ?? null,
      tomadorCnpj: cnpj, tomadorRazao: d.tomadorRazao.trim().slice(0, 160), tomadorEndereco: limpo(d.tomadorEndereco, 300),
      tomadorTelefone: limpo(d.tomadorTelefone, 30), tomadorEmail: limpo(d.tomadorEmail, 160),
      codigoServico: cod, codigoDescricao: limpo(d.codigoDescricao, 200), descricao: d.descricao.trim().slice(0, 2000), observacao: limpo(d.observacao, 400),
    };
  }

  async salvar(tenantId: string, id: string | null, d: DadosModelo) {
    const v = this.validar(d);
    return comTenant(this.db, tenantId, async (tx) => {
      // Um padrão por tipo: o novo padrão tira o anterior.
      if (v.padraoTipo) await tx.update(pessoalModeloNota).set({ padraoTipo: null }).where(and(eq(pessoalModeloNota.tenantId, tenantId), eq(pessoalModeloNota.padraoTipo, v.padraoTipo)));
      if (id) {
        const [r] = await tx.update(pessoalModeloNota).set({ ...v, atualizadoEm: new Date() }).where(and(eq(pessoalModeloNota.tenantId, tenantId), eq(pessoalModeloNota.id, id))).returning();
        if (!r) throw new NotFoundException('Modelo não encontrado.');
        return r;
      }
      return (await tx.insert(pessoalModeloNota).values({ tenantId, ...v }).returning())[0]!;
    });
  }

  async excluir(tenantId: string, id: string) {
    await comTenant(this.db, tenantId, async (tx) => {
      await tx.update(pessoalPrestador).set({ modeloNotaId: null }).where(and(eq(pessoalPrestador.tenantId, tenantId), eq(pessoalPrestador.modeloNotaId, id)));
      await tx.delete(pessoalModeloNota).where(and(eq(pessoalModeloNota.tenantId, tenantId), eq(pessoalModeloNota.id, id)));
    });
    return { excluido: true };
  }

  /** Liga as pessoas a um modelo (null = volta para o padrão do tipo). */
  async aplicar(tenantId: string, modeloId: string | null, prestadorIds: string[]) {
    if (!prestadorIds.length) throw new BadRequestException('Escolha as pessoas.');
    return comTenant(this.db, tenantId, async (tx) => {
      if (modeloId) {
        const m = (await tx.select({ id: pessoalModeloNota.id }).from(pessoalModeloNota).where(and(eq(pessoalModeloNota.tenantId, tenantId), eq(pessoalModeloNota.id, modeloId))).limit(1))[0];
        if (!m) throw new NotFoundException('Modelo não encontrado.');
      }
      const r = await tx.update(pessoalPrestador).set({ modeloNotaId: modeloId })
        .where(and(eq(pessoalPrestador.tenantId, tenantId), inArray(pessoalPrestador.id, prestadorIds))).returning({ id: pessoalPrestador.id });
      return { aplicados: r.length };
    });
  }
}
