import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { pontoAjuste, empregado, pontoMarcacao, pontoRep, usuario, tenant, comTenant, type Db } from '@ponto/db';
import { inicioDoDia, fimDoDia } from '@ponto/rep-core';
import { DB } from '../database/database.module';

export interface NovoAjuste {
  empregadoId: string;
  tipo: 'INCLUSAO' | 'DESCONSIDERAR';
  data: string;
  /** INCLUSAO: hora no formato HH:MM (local) */
  hora?: string;
  tpMarc?: 'E' | 'S';
  /** DESCONSIDERAR: qual marcação original (id ou NSR) */
  marcacaoId?: string;
  nsr?: number;
  observacao: string;
}

/** Primeiro dia do mês anterior — limite de quão pra trás dá pra pedir. */
function limiteRetroativo(hoje = new Date()): string {
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class AjusteService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Descobre o empregado vinculado ao usuário logado (colaborador). */
  async empregadoDoUsuario(usuarioId: string, tenantId: string): Promise<string> {
    return comTenant(this.db, tenantId, async (tx) => {
      const u = (await tx.select({ empregadoId: usuario.empregadoId }).from(usuario)
        .where(eq(usuario.id, usuarioId)).limit(1))[0];
      if (!u?.empregadoId) throw new BadRequestException('Seu usuário não está vinculado a um funcionário.');
      return u.empregadoId;
    });
  }

  /** Pedido do funcionário (ou lançamento do RH, com origem RH). */
  async solicitar(tenantId: string, dto: NovoAjuste, origem: 'FUNCIONARIO' | 'RH' = 'FUNCIONARIO', fuso = '-0300') {
    if (!dto.observacao?.trim()) throw new BadRequestException('Escreva o que aconteceu — a observação é obrigatória.');
    if (dto.data > new Date().toISOString().slice(0, 10)) throw new BadRequestException('Não dá para pedir ajuste de um dia que ainda não aconteceu.');
    if (dto.data < limiteRetroativo()) throw new BadRequestException('Esse dia é de uma competência antiga. Fale com o RH.');

    return comTenant(this.db, tenantId, async (tx) => {
      const emp = (await tx.select({ id: empregado.id }).from(empregado)
        .where(and(eq(empregado.id, dto.empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!emp) throw new NotFoundException('Empregado não encontrado');

      let dtMarcacao: Date | null = null;
      if (dto.tipo === 'INCLUSAO') {
        if (!dto.hora || !/^\d{2}:\d{2}$/.test(dto.hora)) throw new BadRequestException('Informe a hora que faltou (HH:MM).');
        dtMarcacao = new Date(`${dto.data}T${dto.hora}:00${fuso.slice(0, 3)}:${fuso.slice(3)}`);
        if (Number.isNaN(dtMarcacao.getTime())) throw new BadRequestException('Hora inválida.');
      } else {
        // O funcionário aponta pelo NSR (que ele vê na tela); o RH pode mandar o id.
        if (!dto.marcacaoId && dto.nsr != null) {
          const emp2 = (await tx.select({ cpf: empregado.cpf }).from(empregado)
            .where(eq(empregado.id, dto.empregadoId)).limit(1))[0];
          const achada = (await tx.select({ id: pontoMarcacao.id }).from(pontoMarcacao)
            .where(and(eq(pontoMarcacao.tenantId, tenantId), eq(pontoMarcacao.cpf, emp2?.cpf ?? ''),
              eq(pontoMarcacao.nsr, dto.nsr))).limit(1))[0];
          if (!achada) throw new NotFoundException('Batida não encontrada');
          dto = { ...dto, marcacaoId: achada.id };
        }
        if (!dto.marcacaoId) throw new BadRequestException('Escolha qual batida deve ser desconsiderada.');
        const m = (await tx.select({ id: pontoMarcacao.id }).from(pontoMarcacao)
          .where(eq(pontoMarcacao.id, dto.marcacaoId)).limit(1))[0];
        if (!m) throw new NotFoundException('Batida não encontrada');
        const jaTem = (await tx.select({ id: pontoAjuste.id }).from(pontoAjuste).where(and(
          eq(pontoAjuste.tenantId, tenantId), eq(pontoAjuste.marcacaoId, dto.marcacaoId),
          eq(pontoAjuste.status, 'EM_ANALISE'))).limit(1))[0];
        if (jaTem) throw new BadRequestException('Já existe um pedido em análise para essa batida.');
      }

      const [a] = await tx.insert(pontoAjuste).values({
        tenantId, empregadoId: dto.empregadoId, tipo: dto.tipo, data: dto.data,
        dtMarcacao, tpMarc: dto.tipo === 'INCLUSAO' ? (dto.tpMarc ?? 'E') : null,
        marcacaoId: dto.tipo === 'DESCONSIDERAR' ? dto.marcacaoId! : null,
        observacao: dto.observacao.trim(), origem,
        // Lançamento do RH já nasce valendo; pedido do funcionário espera decisão.
        status: origem === 'RH' ? 'APROVADO' : 'EM_ANALISE',
        decididoPor: origem === 'RH' ? 'RH' : null,
        decididoEm: origem === 'RH' ? new Date() : null,
      }).returning();
      return a;
    });
  }

  /** Pedidos aguardando decisão (RH). */
  async pendentes(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const linhas = await tx.select({
        id: pontoAjuste.id, tipo: pontoAjuste.tipo, data: pontoAjuste.data,
        dtMarcacao: pontoAjuste.dtMarcacao, tpMarc: pontoAjuste.tpMarc, marcacaoId: pontoAjuste.marcacaoId,
        observacao: pontoAjuste.observacao, criadoEm: pontoAjuste.criadoEm,
        empregadoId: pontoAjuste.empregadoId, nome: empregado.nome,
      }).from(pontoAjuste)
        .innerJoin(empregado, eq(empregado.id, pontoAjuste.empregadoId))
        .where(and(eq(pontoAjuste.tenantId, tenantId), eq(pontoAjuste.status, 'EM_ANALISE')))
        .orderBy(desc(pontoAjuste.criadoEm));

      // hora da batida que se quer desconsiderar, pra o RH ver o contexto
      const comHora = await Promise.all(linhas.map(async (l) => {
        if (l.tipo !== 'DESCONSIDERAR' || !l.marcacaoId) return { ...l, horaAlvo: null as Date | null };
        const m = (await tx.select({ dt: pontoMarcacao.dtMarcacao }).from(pontoMarcacao)
          .where(eq(pontoMarcacao.id, l.marcacaoId)).limit(1))[0];
        return { ...l, horaAlvo: m?.dt ?? null };
      }));
      return comHora;
    });
  }

  /** Histórico do funcionário (o que ele pediu e em que pé está). */
  async meus(tenantId: string, empregadoId: string) {
    return comTenant(this.db, tenantId, (tx) =>
      tx.select().from(pontoAjuste)
        .where(and(eq(pontoAjuste.tenantId, tenantId), eq(pontoAjuste.empregadoId, empregadoId)))
        .orderBy(desc(pontoAjuste.criadoEm)));
  }

  /** RH aprova ou recusa. Recusa exige motivo. */
  async decidir(tenantId: string, id: string, aprovar: boolean, motivo: string | null, quem: string) {
    if (!aprovar && !motivo?.trim()) throw new BadRequestException('Diga o motivo da recusa — o funcionário precisa saber.');
    return comTenant(this.db, tenantId, async (tx) => {
      const atual = (await tx.select().from(pontoAjuste)
        .where(and(eq(pontoAjuste.id, id), eq(pontoAjuste.tenantId, tenantId))).limit(1))[0];
      if (!atual) throw new NotFoundException('Pedido não encontrado');
      if (atual.status !== 'EM_ANALISE') throw new ForbiddenException('Este pedido já foi decidido.');

      const [a] = await tx.update(pontoAjuste).set({
        status: aprovar ? 'APROVADO' : 'RECUSADO',
        motivoDecisao: motivo?.trim() ?? null,
        decididoPor: quem.slice(0, 160), decididoEm: new Date(),
      }).where(and(eq(pontoAjuste.id, id), eq(pontoAjuste.tenantId, tenantId))).returning();
      return a;
    });
  }

  /** Batidas do dia (só daquele dia, no fuso do tenant), em ordem. */
  async batidasDoDia(tenantId: string, empregadoId: string, data: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const emp = (await tx.select({ cpf: empregado.cpf }).from(empregado)
        .where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!emp) throw new NotFoundException('Empregado não encontrado');
      const rep = (await tx.select({ id: pontoRep.id }).from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1))[0];
      if (!rep) return [];
      const fuso = (await tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0]?.fuso ?? '-0300';
      return tx.select({ id: pontoMarcacao.id, dtMarcacao: pontoMarcacao.dtMarcacao, nsr: pontoMarcacao.nsr })
        .from(pontoMarcacao)
        .where(and(eq(pontoMarcacao.repId, rep.id), eq(pontoMarcacao.cpf, emp.cpf),
          gte(pontoMarcacao.dtMarcacao, inicioDoDia(data, fuso)), lte(pontoMarcacao.dtMarcacao, fimDoDia(data, fuso))))
        .orderBy(asc(pontoMarcacao.dtMarcacao));
    });
  }
}
