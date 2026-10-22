import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  comTenant, dispositivo, empregado, empregadoEscalaVigencia, pontoFeriado, pontoHorarioContratual, pontoPerfilRegra, tenant, usuario, type Db,
} from '@ponto/db';
import { DB } from '../database/database.module';
import { classificarCompensacao, type Compensacao, type EscalaIn, type OrigemPerfil } from './compensacao';

const hojeBr = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

export interface LinhaCompensacao extends Compensacao {
  empregadoId: string; nome: string; matricula: string | null;
  /** Mudança de escala já agendada (vigência que começa depois de hoje). */
  proximaEscala: { codigo: string; aPartirDe: string } | null;
}

/**
 * Central de Ajuda: o "raio-x" de como as horas de cada funcionário são
 * contadas e o checklist de implantação (o que falta configurar).
 */
@Injectable()
export class AjudaService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async dados(tenantId: string, empregadoId?: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const t = (await tx.select({ tipo: tenant.bancoTipoAcordo, prazo: tenant.bancoPrazoMeses }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
      const emps = await tx.select({ id: empregado.id, nome: empregado.nome, matricula: empregado.matricula, horario: empregado.horarioContratualId, perfil: empregado.perfilRegraId, ativo: empregado.ativo })
        .from(empregado).where(empregadoId ? and(eq(empregado.tenantId, tenantId), eq(empregado.id, empregadoId)) : and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)));
      const ids = emps.map((e) => e.id);
      const vigs = ids.length ? await tx.select().from(empregadoEscalaVigencia).where(and(eq(empregadoEscalaVigencia.tenantId, tenantId), inArray(empregadoEscalaVigencia.empregadoId, ids))) : [];
      const horarios = await tx.select().from(pontoHorarioContratual).where(eq(pontoHorarioContratual.tenantId, tenantId));
      const perfis = await tx.select({ id: pontoPerfilRegra.id, nome: pontoPerfilRegra.nome, padrao: pontoPerfilRegra.padrao, config: pontoPerfilRegra.config })
        .from(pontoPerfilRegra).where(eq(pontoPerfilRegra.tenantId, tenantId));
      return { empresa: { tipoAcordo: t?.tipo ?? 'NENHUM', prazoMeses: t?.prazo ?? null }, emps, vigs, horarios, perfis };
    });
  }

  private montar(d: Awaited<ReturnType<AjudaService['dados']>>): LinhaCompensacao[] {
    const hoje = hojeBr();
    const hor = new Map(d.horarios.map((h) => [h.id, h]));
    const per = new Map(d.perfis.map((p) => [p.id, p]));
    const padrao = d.perfis.find((p) => p.padrao) ?? null;
    const esc = (id: string | null | undefined): EscalaIn | null => {
      const h = id ? hor.get(id) : undefined;
      return h ? { id: h.id, codigo: h.codigo, regime: h.regime, flexivel: h.flexivel, compensaSemana: h.compensaSemana, durJornadaMin: h.durJornadaMin, diasSemana: h.diasSemana, jornadaPorDia: h.jornadaPorDia } : null;
    };
    return d.emps.map((e) => {
      const vs = d.vigs.filter((v) => v.empregadoId === e.id);
      // Escala de HOJE (a mesma regra da apuração); sem vigência, a escala do cadastro.
      const hojeV = vs.find((v) => v.dataInicio <= hoje && (!v.dataFim || v.dataFim >= hoje));
      const futura = vs.filter((v) => v.dataInicio > hoje).sort((a, b) => a.dataInicio.localeCompare(b.dataInicio))[0];
      // Mesma regra da apuração (escalaDoDia): vigência que cobre o dia, senão o horário do cadastro.
      const escala = esc(hojeV?.horarioContratualId ?? e.horario);
      const proprio = e.perfil ? per.get(e.perfil) ?? null : null;
      const perfil = proprio ?? padrao;
      const origem: OrigemPerfil = proprio ? 'PROPRIO' : padrao ? 'PADRAO' : 'NENHUM';
      const c = classificarCompensacao(escala, perfil, origem, d.empresa);
      const fut = futura ? hor.get(futura.horarioContratualId) : undefined;
      return { empregadoId: e.id, nome: e.nome, matricula: e.matricula, ...c,
        proximaEscala: futura && fut ? { codigo: fut.codigo, aPartirDe: futura.dataInicio } : null };
    }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  /** Todos os ativos, com totais por nível e quantos merecem atenção. */
  async compensacao(tenantId: string) {
    const d = await this.dados(tenantId);
    const linhas = this.montar(d);
    const cont = (n: string) => linhas.filter((l) => l.nivel === n).length;
    return {
      empresa: d.empresa,
      perfilPadrao: d.perfis.find((p) => p.padrao)?.nome ?? null,
      totais: {
        pessoas: linhas.length, semEscala: cont('SEM_ESCALA'), nao: cont('NAO'), semana: cont('SEMANA'), mes: cont('MES'), acumula: cont('ACUMULA'),
        atencao: linhas.filter((l) => l.alertas.some((a) => a.gravidade === 'erro')).length,
        avisos: linhas.filter((l) => l.alertas.some((a) => a.gravidade === 'aviso')).length,
      },
      linhas,
    };
  }

  /** Raio-x de uma pessoa, com o histórico de escala. */
  async compensacaoDe(tenantId: string, empregadoId: string) {
    const d = await this.dados(tenantId, empregadoId);
    if (!d.emps.length) throw new NotFoundException('Funcionário não encontrado');
    const [linha] = this.montar(d);
    const hor = new Map(d.horarios.map((h) => [h.id, h.codigo]));
    const historico = d.vigs.sort((a, b) => b.dataInicio.localeCompare(a.dataInicio))
      .map((v) => ({ codigo: hor.get(v.horarioContratualId) ?? '?', dataInicio: v.dataInicio, dataFim: v.dataFim }));
    return { ...linha!, empresa: d.empresa, historico };
  }

  /** "Comece aqui": o que a empresa já configurou e o que falta. */
  async implantacao(tenantId: string) {
    const d = await this.dados(tenantId);
    const linhas = this.montar(d);
    const r = await comTenant(this.db, tenantId, async (tx) => {
      const t = (await tx.select({ lat: tenant.latitude }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
      const feriados = (await tx.select({ id: pontoFeriado.id }).from(pontoFeriado).where(eq(pontoFeriado.tenantId, tenantId))).length;
      const quiosques = (await tx.select({ id: dispositivo.id }).from(dispositivo).where(and(eq(dispositivo.tenantId, tenantId), eq(dispositivo.ativo, true)))).length;
      const ids = linhas.map((l) => l.empregadoId);
      const contas = ids.length ? (await tx.select({ e: usuario.empregadoId }).from(usuario)
        .where(and(eq(usuario.tenantId, tenantId), eq(usuario.ativo, true), inArray(usuario.empregadoId, ids)))).length : 0;
      return { local: t?.lat != null, feriados, quiosques, contas };
    });
    const semEscala = linhas.filter((l) => l.nivel === 'SEM_ESCALA').length;
    const atencao = linhas.filter((l) => l.alertas.some((a) => a.gravidade === 'erro' && a.codigo !== 'SEM_ESCALA')).length;
    const passos = [
      { id: 'local', titulo: 'Local e cerca', ok: r.local, detalhe: r.local ? 'local cadastrado' : 'sem endereço/cerca da empresa', rota: '/rh/local', artigo: 'local' },
      { id: 'feriados', titulo: 'Feriados', ok: r.feriados > 0, detalhe: r.feriados ? `${r.feriados} feriados` : 'nenhum feriado cadastrado', rota: '/rh/feriados', artigo: 'feriados' },
      { id: 'escalas', titulo: 'Escalas', ok: d.horarios.length > 0, detalhe: d.horarios.length ? `${d.horarios.length} ${d.horarios.length === 1 ? 'escala' : 'escalas'}` : 'nenhuma escala', rota: '/rh/escalas', artigo: 'escalas' },
      { id: 'regras', titulo: 'Regras de cálculo', ok: d.perfis.some((p) => p.padrao), detalhe: d.perfis.length === 0 ? 'nenhum perfil (vale a CLT pura)' : d.perfis.some((p) => p.padrao) ? `padrão: ${d.perfis.find((p) => p.padrao)!.nome}` : 'nenhum perfil marcado como padrão', rota: '/rh/regras', artigo: 'regras' },
      { id: 'funcionarios', titulo: 'Funcionários', ok: linhas.length > 0 && semEscala === 0 && atencao === 0,
        detalhe: linhas.length === 0 ? 'nenhum funcionário' : [semEscala && `${semEscala} sem escala`, atencao && `${atencao} com horas que não compensam`].filter(Boolean).join(' · ') || `${linhas.length} configurados`,
        rota: '/rh/funcionarios', artigo: 'cadastrar-funcionario' },
      { id: 'acesso', titulo: 'Acesso ao app / quiosque', ok: r.quiosques > 0 || (linhas.length > 0 && r.contas >= linhas.length),
        detalhe: `${r.contas} de ${linhas.length} com app${r.quiosques ? ` · ${r.quiosques} ${r.quiosques === 1 ? 'quiosque' : 'quiosques'}` : ''}`, rota: '/rh/funcionarios', artigo: 'acesso-app' },
    ];
    return { passos, feitos: passos.filter((p) => p.ok).length, atencao, semEscala };
  }
}
