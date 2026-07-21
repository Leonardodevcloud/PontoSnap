import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import { pontoConvencao, pontoRegraItem, empregado, comTenant, type Db, type TipoRegraItem } from '@ponto/db';
import { DB } from '../database/database.module';
import { CctService } from '../cct/cct.service';
import type { ExtracaoCct } from '../cct/extrair-cct';

// Lista/detalhe sem o PDF (que é pesado) — o PDF só é lido sob demanda.
const CAMPOS = {
  id: pontoConvencao.id, nome: pontoConvencao.nome, sindicato: pontoConvencao.sindicato,
  uf: pontoConvencao.uf, vigencia: pontoConvencao.vigencia,
  numeroRegistroMte: pontoConvencao.numeroRegistroMte, categoria: pontoConvencao.categoria,
  observacoes: pontoConvencao.observacoes, pdfNome: pontoConvencao.pdfNome,
};

type Dados = Omit<typeof pontoConvencao.$inferInsert, 'id' | 'tenantId' | 'criadoEm'>;

@Injectable()
export class ConvencaoService {
  constructor(@Inject(DB) private readonly db: Db, private readonly cct: CctService) {}

  async listar(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const linhas = await tx.select({ ...CAMPOS, temPdf: pontoConvencao.pdfNome }).from(pontoConvencao)
        .where(eq(pontoConvencao.tenantId, tenantId)).orderBy(asc(pontoConvencao.nome));
      const cont = await tx.select({ id: empregado.convencaoId, n: count() }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)))
        .groupBy(empregado.convencaoId);
      const por = new Map(cont.map((c) => [c.id, Number(c.n)]));
      return linhas.map((c) => ({ ...c, temPdf: !!c.pdfNome, funcionarios: por.get(c.id) ?? 0 }));
    });
  }

  async criar(tenantId: string, dados: Dados) {
    if (!dados.nome?.trim()) throw new BadRequestException('Dê um nome à convenção');
    return comTenant(this.db, tenantId, async (tx) => {
      const [c] = await tx.insert(pontoConvencao).values({ ...dados, tenantId }).returning(CAMPOS);
      return c;
    });
  }

  async atualizar(tenantId: string, id: string, dados: Dados) {
    return comTenant(this.db, tenantId, async (tx) => {
      // Não sobrescreve o PDF com nulo quando o form não reenvia o arquivo.
      const set: Partial<Dados> = { ...dados };
      if (set.pdfBase64 == null) { delete set.pdfBase64; delete set.pdfNome; }
      const [c] = await tx.update(pontoConvencao).set(set)
        .where(and(eq(pontoConvencao.id, id), eq(pontoConvencao.tenantId, tenantId))).returning(CAMPOS);
      if (!c) throw new NotFoundException('Convenção não encontrada');
      return c;
    });
  }

  async remover(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const usados = (await tx.select({ n: count() }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.convencaoId, id))))[0]?.n ?? 0;
      if (Number(usados) > 0) throw new BadRequestException('Há funcionários usando esta convenção. Troque-os antes de remover.');
      await tx.delete(pontoConvencao).where(and(eq(pontoConvencao.id, id), eq(pontoConvencao.tenantId, tenantId)));
      return { removido: true };
    });
  }

  /** Lê o PDF e cria/atualiza os 6 itens de regra desta convenção (IA). */
  async gerarRegra(tenantId: string, id: string): Promise<{ itens: number; citacoes: ExtracaoCct['citacoes'] }> {
    const conv = await comTenant(this.db, tenantId, async (tx) =>
      (await tx.select({ nome: pontoConvencao.nome, pdf: pontoConvencao.pdfBase64 }).from(pontoConvencao)
        .where(and(eq(pontoConvencao.id, id), eq(pontoConvencao.tenantId, tenantId))).limit(1))[0]);
    if (!conv?.pdf) throw new BadRequestException('Esta convenção não tem PDF anexado.');

    const ex = await this.cct.extrairDoPdf(conv.pdf);
    const v = ex.valores;
    const nome = (sufixo: string) => `${conv.nome} · ${sufixo}`;
    const pecas: { tipo: TipoRegraItem; nome: string; config: Record<string, unknown> }[] = [
      { tipo: 'EXTRA', nome: nome('extra'), config: { extraDiaUtilPct: v.extraDiaUtilPct ?? 50, extraDomingoFeriadoPct: v.extraDomingoFeriadoPct ?? 100, extraLimiteDiarioMin: 120 } },
      { tipo: 'TOLERANCIA', nome: nome('tolerância'), config: { toleranciaDiariaMin: v.toleranciaDiariaMin ?? 10, toleranciaPorMarcacaoMin: v.toleranciaPorMarcacaoMin ?? 5 } },
      { tipo: 'NOTURNO', nome: nome('noturno'), config: { noturnoAdicionalPct: v.noturnoAdicionalPct ?? 20, noturnoReduzida: true, noturnoInicioMin: 1320, noturnoFimMin: 300 } },
      { tipo: 'JORNADA', nome: nome('jornada'), config: { jornadaSemanalMin: v.jornadaSemanalMin ?? 2640, interjornadaMinimaMin: v.interjornadaMinimaMin ?? 660, intervaloMaior6hMin: v.intervaloMaior6hMin ?? 60 } },
      { tipo: 'BANCO', nome: nome('banco'), config: { bancoModo: v.bancoPrazoMeses ? 'ATIVO' : 'HERDA', bancoTipoAcordo: v.bancoPrazoMeses && v.bancoPrazoMeses >= 12 ? 'COLETIVO' : v.bancoPrazoMeses ? 'INDIVIDUAL' : null, bancoPrazoMeses: v.bancoPrazoMeses ?? null, formaCalculo: 'BANCO_HORAS' } },
      { tipo: 'DESTINACAO', nome: nome('destinação'), config: { destinacaoFaltas: 'DESCONTA', destinacaoAtrasos: 'BANCO' } },
    ];

    await comTenant(this.db, tenantId, async (tx) => {
      const existentes = await tx.select({ id: pontoRegraItem.id, tipo: pontoRegraItem.tipo }).from(pontoRegraItem)
        .where(and(eq(pontoRegraItem.tenantId, tenantId), eq(pontoRegraItem.convencaoId, id)));
      const porTipo = new Map(existentes.map((e) => [e.tipo, e.id]));
      for (const p of pecas) {
        const existe = porTipo.get(p.tipo);
        if (existe) {
          await tx.update(pontoRegraItem).set({ nome: p.nome, config: p.config })
            .where(and(eq(pontoRegraItem.id, existe), eq(pontoRegraItem.tenantId, tenantId)));
        } else {
          await tx.insert(pontoRegraItem).values({ tenantId, tipo: p.tipo, nome: p.nome, config: p.config, convencaoId: id });
        }
      }
    });
    return { itens: pecas.length, citacoes: ex.citacoes };
  }
}
