import { createHash } from 'node:crypto';
import { Inject, Injectable, NotFoundException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { espelhoAssinatura, empregado, usuario, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { TratamentoService } from '../tratamento/tratamento.service';
import { verificarPin } from '../auth/pin';

const limitesDoMes = (competencia: string) => {
  const [a, m] = competencia.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
  return { inicio: `${competencia}-01`, fim: `${competencia}-${String(ultimo).padStart(2, '0')}` };
};

const refCurta = (id: string) => id.replace(/-/g, '').slice(0, 8).toUpperCase();

@Injectable()
export class EspelhoAssinaturaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tratamento: TratamentoService,
  ) {}

  /** Resolve o empregado a partir do usuário logado (colaborador). */
  async empregadoDoUsuario(tenantId: string, usuarioId: string): Promise<string> {
    return comTenant(this.db, tenantId, async (tx) => {
      const us = (await tx.select({ empregadoId: usuario.empregadoId }).from(usuario).where(eq(usuario.id, usuarioId)).limit(1))[0];
      if (!us?.empregadoId) throw new ForbiddenException('Este acesso não está vinculado a um funcionário.');
      return us.empregadoId;
    });
  }

  /**
   * Hash do espelho SEM a assinatura — é o que o funcionário confere e o que
   * fica registrado. Regerar o mesmo espelho dá o mesmo hash; se algo mudou
   * (batida, ajuste), o hash muda e a assinatura anterior deixa de casar.
   *
   * O hash é do CONTEÚDO (linhas + totais), não dos bytes do PDF — assim ele
   * não muda por causa da data de geração impressa no rodapé.
   */
  private async hashDoEspelho(tenantId: string, empregadoId: string, competencia: string): Promise<string> {
    const { inicio, fim } = limitesDoMes(competencia);
    const conteudo = await this.tratamento.conteudoEspelho(tenantId, empregadoId, inicio, fim);
    return createHash('sha256').update(JSON.stringify(conteudo)).digest('hex');
  }

  /** Estado da assinatura de uma competência: se está assinada e se ainda casa. */
  async status(tenantId: string, empregadoId: string, competencia: string) {
    const hashAtual = await this.hashDoEspelho(tenantId, empregadoId, competencia);
    const ass = await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(espelhoAssinatura)
        .where(and(eq(espelhoAssinatura.empregadoId, empregadoId), eq(espelhoAssinatura.competencia, competencia)))
        .limit(1));
    const a = ass[0];
    if (!a) return { assinado: false, confere: false, hashAtual };
    return {
      assinado: true,
      // Se o espelho mudou depois de assinado, o hash não bate mais.
      confere: a.hashDocumento === hashAtual,
      assinadoEm: a.assinadoEm, via: a.via, hashAtual, hashAssinado: a.hashDocumento,
    };
  }

  /**
   * Funcionário concorda e assina, validando o PIN. Grava o hash do espelho
   * conferido. Se já havia assinatura da competência, substitui (reassinatura).
   */
  async assinar(tenantId: string, empregadoId: string, competencia: string, pin: string, ip?: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const emp = (await tx.select({ id: empregado.id, nome: empregado.nome, cpf: empregado.cpf, pinHash: empregado.pinHash })
        .from(empregado).where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!emp) throw new NotFoundException('Empregado não encontrado');
      if (!emp.pinHash) throw new ForbiddenException('Você ainda não tem PIN definido. Procure o RH para cadastrar.');
      if (!(await verificarPin(pin, emp.pinHash))) throw new UnauthorizedException('PIN incorreto.');

      const hash = await this.hashDoEspelho(tenantId, empregadoId, competencia);
      const id = crypto.randomUUID();
      await tx.insert(espelhoAssinatura).values({
        id, tenantId, empregadoId, competencia, hashDocumento: hash, via: 'PIN no app', ip: ip ?? null, auditoriaRef: refCurta(id),
      }).onConflictDoUpdate({
        target: [espelhoAssinatura.empregadoId, espelhoAssinatura.competencia],
        set: { hashDocumento: hash, assinadoEm: new Date(), ip: ip ?? null, auditoriaRef: refCurta(id) },
      });
      return { assinado: true, em: new Date(), nome: emp.nome };
    });
  }

  /** Dados da assinatura para o carimbo do PDF (usado pelo RH ao baixar). */
  async paraCarimbo(tenantId: string, empregadoId: string, competencia: string) {
    const st = await this.status(tenantId, empregadoId, competencia);
    if (!st.assinado || !st.confere) return null;
    const emp = (await comTenant(this.db, tenantId, (tx) =>
      tx.select({ nome: empregado.nome, cpf: empregado.cpf }).from(empregado).where(eq(empregado.id, empregadoId)).limit(1)))[0];
    const ass = (await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(espelhoAssinatura).where(and(eq(espelhoAssinatura.empregadoId, empregadoId), eq(espelhoAssinatura.competencia, competencia))).limit(1)))[0];
    if (!emp || !ass) return null;
    return {
      nome: emp.nome, cpf: emp.cpf,
      em: new Date(ass.assinadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      via: ass.via, hashDocumento: ass.hashDocumento.slice(0, 18), referencia: ass.auditoriaRef ?? undefined,
    };
  }
}
