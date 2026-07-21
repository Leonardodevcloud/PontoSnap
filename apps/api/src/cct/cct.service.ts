import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, asc, eq, count, ne } from 'drizzle-orm';
import { pontoCct, empregado, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { mapearGeminiParaCct, type ExtracaoCct } from './extrair-cct';

const CAMPOS = {
  id: pontoCct.id, nome: pontoCct.nome, uf: pontoCct.uf, vigencia: pontoCct.vigencia,
  extraDiaUtilPct: pontoCct.extraDiaUtilPct, extraDomingoFeriadoPct: pontoCct.extraDomingoFeriadoPct,
  extraLimiteDiarioMin: pontoCct.extraLimiteDiarioMin,
  toleranciaDiariaMin: pontoCct.toleranciaDiariaMin, toleranciaPorMarcacaoMin: pontoCct.toleranciaPorMarcacaoMin,
  noturnoAdicionalPct: pontoCct.noturnoAdicionalPct, noturnoReduzida: pontoCct.noturnoReduzida,
  noturnoInicioMin: pontoCct.noturnoInicioMin, noturnoFimMin: pontoCct.noturnoFimMin,
  jornadaSemanalMin: pontoCct.jornadaSemanalMin, interjornadaMinimaMin: pontoCct.interjornadaMinimaMin,
  intervaloMaior6hMin: pontoCct.intervaloMaior6hMin, bancoPrazoMeses: pontoCct.bancoPrazoMeses,
  bancoModo: pontoCct.bancoModo, bancoTipoAcordo: pontoCct.bancoTipoAcordo,
  ativa: pontoCct.ativa, padrao: pontoCct.padrao,
};

type Dados = Omit<typeof pontoCct.$inferInsert, 'id' | 'tenantId' | 'criadoEm'>;

@Injectable()
export class CctService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Lista as convenções da empresa, com quantos funcionários em cada. */
  async listar(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const ccts = await tx.select(CAMPOS).from(pontoCct)
        .where(eq(pontoCct.tenantId, tenantId)).orderBy(asc(pontoCct.nome));
      const contagem = await tx.select({ cctId: empregado.cctId, n: count() }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)))
        .groupBy(empregado.cctId);
      const porCct = new Map(contagem.map((c) => [c.cctId, Number(c.n)]));
      return ccts.map((c) => ({ ...c, funcionarios: porCct.get(c.id) ?? 0 }));
    });
  }

  async criar(tenantId: string, dados: Dados) {
    if (!dados.nome?.trim()) throw new BadRequestException('Dê um nome à convenção');
    return comTenant(this.db, tenantId, async (tx) => {
      if (dados.padrao) await this.limparPadrao(tx, tenantId);
      const [c] = await tx.insert(pontoCct).values({ ...dados, tenantId }).returning(CAMPOS);
      return c;
    });
  }

  async atualizar(tenantId: string, id: string, dados: Dados) {
    return comTenant(this.db, tenantId, async (tx) => {
      if (dados.padrao) await this.limparPadrao(tx, tenantId, id);
      const [c] = await tx.update(pontoCct).set(dados)
        .where(and(eq(pontoCct.id, id), eq(pontoCct.tenantId, tenantId))).returning(CAMPOS);
      if (!c) throw new NotFoundException('Convenção não encontrada');
      return c;
    });
  }

  /** Garante uma única regra padrão por empresa (desmarca as outras). */
  private async limparPadrao(tx: Parameters<Parameters<typeof comTenant>[2]>[0], tenantId: string, exceto?: string) {
    const cond = exceto
      ? and(eq(pontoCct.tenantId, tenantId), eq(pontoCct.padrao, true), ne(pontoCct.id, exceto))
      : and(eq(pontoCct.tenantId, tenantId), eq(pontoCct.padrao, true));
    await tx.update(pontoCct).set({ padrao: false }).where(cond);
  }

  /** Só remove se nenhum funcionário estiver vinculado. */
  async remover(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const usados = (await tx.select({ n: count() }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.cctId, id))))[0]?.n ?? 0;
      if (Number(usados) > 0) {
        throw new BadRequestException('Há funcionários usando esta convenção. Troque-os antes de remover.');
      }
      await tx.delete(pontoCct).where(and(eq(pontoCct.id, id), eq(pontoCct.tenantId, tenantId)));
      return { removido: true };
    });
  }

  /**
   * Lê o PDF da CCT com o Gemini e devolve um rascunho dos parâmetros + as
   * cláusulas que ele citou. NÃO salva nada — o RH confere e salva depois.
   */
  async extrairDoPdf(base64: string): Promise<ExtracaoCct> {
    const chave = process.env.GEMINI_API_KEY;
    if (!chave) {
      throw new ServiceUnavailableException('Leitura por IA não configurada (defina GEMINI_API_KEY).');
    }
    const bruto = Buffer.from(base64, 'base64');
    if (bruto.length === 0) throw new BadRequestException('PDF vazio');
    if (bruto.length > 7 * 1024 * 1024) {
      throw new BadRequestException('PDF acima de 7 MB. Comprima o arquivo ou preencha à mão.');
    }
    const modelo = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${chave}`;

    const prompt = [
      'Você é um assistente de RH no Brasil. Leia esta Convenção Coletiva de Trabalho (CCT/ACT)',
      'e extraia os parâmetros de jornada para um sistema de ponto eletrônico.',
      'Regras de saída:',
      '- Percentuais: só o número (ex.: 60 para 60%).',
      '- Tempos em MINUTOS (jornada semanal 44h = 2640; interjornada 11h = 660; intervalo 60).',
      '- Se a convenção NÃO tratar de um item, use o padrão da CLT: extra dia útil 50, domingo/feriado 100,',
      '  tolerância diária 10, por marcação 5, noturno 20, jornada 2640, interjornada 660, intervalo 60.',
      '- Em "citacoes", inclua APENAS os itens que você encontrou EXPLÍCITOS na convenção,',
      '  com o campo e o trecho/cláusula de onde tirou (ex.: "Cláusula 12ª — 60% nas 2 primeiras horas").',
      '- Não invente. Na dúvida, use o padrão da CLT e não cite.',
    ].join('\n');

    const corpo = {
      contents: [{ parts: [
        { inline_data: { mime_type: 'application/pdf', data: base64 } },
        { text: prompt },
      ] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            nome: { type: 'STRING' }, uf: { type: 'STRING' }, vigencia: { type: 'STRING' },
            extraDiaUtilPct: { type: 'NUMBER' }, extraDomingoFeriadoPct: { type: 'NUMBER' },
            toleranciaDiariaMin: { type: 'NUMBER' }, toleranciaPorMarcacaoMin: { type: 'NUMBER' },
            noturnoAdicionalPct: { type: 'NUMBER' }, jornadaSemanalMin: { type: 'NUMBER' },
            interjornadaMinimaMin: { type: 'NUMBER' }, intervaloMaior6hMin: { type: 'NUMBER' },
            bancoPrazoMeses: { type: 'NUMBER' },
            citacoes: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
              campo: { type: 'STRING' }, texto: { type: 'STRING' },
            } } },
          },
        },
      },
    };

    let resp: Response;
    try {
      resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    } catch {
      throw new ServiceUnavailableException('Não consegui falar com a IA agora. Tente de novo ou preencha à mão.');
    }
    if (!resp.ok) {
      throw new ServiceUnavailableException(`A IA recusou a leitura (código ${resp.status}). Tente de novo ou preencha à mão.`);
    }
    const data: any = await resp.json().catch(() => null);
    const texto: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) throw new ServiceUnavailableException('A IA não retornou dados legíveis. Preencha à mão.');

    let json: unknown;
    try { json = JSON.parse(texto); }
    catch { throw new ServiceUnavailableException('A IA respondeu num formato inesperado. Preencha à mão.'); }

    return mapearGeminiParaCct(json);
  }
}
