import { describe, expect, it } from 'vitest';
import { classificarCompensacao, type EscalaIn, type PerfilIn } from '../src/ajuda/compensacao';

const esc = (o: Partial<EscalaIn> = {}): EscalaIn => ({ id: 'e', codigo: 'CH-8H', regime: 'normal', flexivel: false, compensaSemana: false, durJornadaMin: 480, diasSemana: [1, 2, 3, 4, 5], ...o });
const perfil = (config: unknown, nome = 'P'): PerfilIn => ({ id: 'p', nome, padrao: false, config });
const SEM = { tipoAcordo: 'NENHUM', prazoMeses: null };
const COM = { tipoAcordo: 'INDIVIDUAL', prazoMeses: 6 };
const codigos = (c: ReturnType<typeof classificarCompensacao>) => c.alertas.map((a) => a.codigo);

describe('classificarCompensacao', () => {
  it('sem escala: não calcula', () => {
    const c = classificarCompensacao(null, null, 'NENHUM', SEM);
    expect(c.nivel).toBe('SEM_ESCALA');
    expect(codigos(c)).toContain('SEM_ESCALA');
  });

  it('CLT pura com horário fixo: não compensa, mas não é alerta grave (escolha válida)', () => {
    const c = classificarCompensacao(esc(), null, 'NENHUM', SEM);
    expect(c.nivel).toBe('NAO');
    expect(c.niveis).toEqual({ dia: true, semana: false, mes: false, acumula: false });
    expect(c.alertas.some((a) => a.gravidade === 'erro')).toBe(false);
    expect(codigos(c)).toContain('SEM_PERFIL');
    expect(c.destinacao.atrasos).toBe('DESCONTA'); // BANCO sem banco vira desconto
  });

  it('contrato de horas sem banco nem semana: alerta grave', () => {
    const c = classificarCompensacao(esc({ flexivel: true }), null, 'NENHUM', SEM);
    expect(c.jornada).toBe('CONTRATO_HORAS');
    expect(c.nivel).toBe('NAO');
    expect(c.resumo).toBe('cada dia fecha sozinho');
    expect(codigos(c)).toContain('CONTRATO_SEM_COMPENSACAO');
  });

  it('perfil com banco "segue a empresa" e empresa sem acordo: sem banco', () => {
    const c = classificarCompensacao(esc({ flexivel: true }), perfil({ banco: null }, 'Operação'), 'PROPRIO', SEM);
    expect(c.banco).toMatchObject({ ativo: false, origem: 'EMPRESA' });
    expect(codigos(c)).toEqual(expect.arrayContaining(['CONTRATO_SEM_COMPENSACAO', 'BANCO_EMPRESA_SEM_ACORDO']));
  });

  it('HERDA com empresa com acordo: acumula com o prazo da empresa (INTRA_MES não herda)', () => {
    const c = classificarCompensacao(esc(), perfil({ banco: { bancoModo: 'HERDA', formaCalculo: 'INTRA_MES' } }), 'PROPRIO', { tipoAcordo: 'COLETIVO', prazoMeses: 12 });
    expect(c.nivel).toBe('ACUMULA');
    expect(c.banco).toMatchObject({ ativo: true, origem: 'EMPRESA', tipoAcordo: 'COLETIVO', prazoMeses: 12 });
  });

  it('compensa na semana na escala', () => {
    const c = classificarCompensacao(esc({ compensaSemana: true }), null, 'PADRAO', SEM);
    expect(c.nivel).toBe('SEMANA');
    expect(c.niveis.semana).toBe(true);
    expect(c.niveis.mes).toBe(false);
    expect(codigos(c)).toContain('FALTA_DESCONTA');
  });

  it('compensa na semana é ignorado em 12x36', () => {
    const c = classificarCompensacao(esc({ regime: 'r12x36', compensaSemana: true }), null, 'NENHUM', SEM);
    expect(c.semana).toBe(false);
    expect(c.jornada).toBe('12X36');
    expect(c.nivel).toBe('NAO');
  });

  it('banco no mês no perfil (empresa sem acordo não importa)', () => {
    const c = classificarCompensacao(esc({ flexivel: true }), perfil({ banco: { bancoModo: 'ATIVO', formaCalculo: 'INTRA_MES', negativoMes: 'CARREGA' }, destinacao: { destinacaoFaltas: 'BANCO', destinacaoAtrasos: 'BANCO' } }), 'PROPRIO', SEM);
    expect(c.nivel).toBe('MES');
    expect(c.banco).toMatchObject({ ativo: true, modo: 'MES', origem: 'PERFIL', negativoMes: 'CARREGA', prazoMeses: null });
    expect(c.destinacao).toEqual({ faltas: 'BANCO', atrasos: 'BANCO' });
    expect(c.alertas).toEqual([]);
  });

  it('banco ativo com atraso descontado: aviso', () => {
    const c = classificarCompensacao(esc(), perfil({ banco: { bancoModo: 'ATIVO', formaCalculo: 'BANCO_HORAS', bancoPrazoMeses: 6 }, destinacao: { destinacaoFaltas: 'DESCONTA', destinacaoAtrasos: 'DESCONTA' } }), 'PROPRIO', SEM);
    expect(c.nivel).toBe('ACUMULA');
    expect(c.banco.prazoMeses).toBe(6);
    expect(codigos(c)).toEqual(expect.arrayContaining(['ATRASO_DESCONTA_COM_BANCO', 'FALTA_DESCONTA']));
  });

  it('banco INATIVO no perfil vence o acordo da empresa', () => {
    const c = classificarCompensacao(esc(), perfil({ banco: { bancoModo: 'INATIVO' } }), 'PROPRIO', COM);
    expect(c.banco).toMatchObject({ ativo: false, origem: 'PERFIL' });
    expect(c.nivel).toBe('NAO');
  });

  it('perfil antigo "contrato de horas" força flexível na escala fixa', () => {
    const c = classificarCompensacao(esc(), perfil({ contrato: { tipoJornada: 'CONTRATO_HORAS' } }, 'Antigo'), 'PROPRIO', SEM);
    expect(c.escala?.tipo).toBe('FIXO');
    expect(c.jornada).toBe('CONTRATO_HORAS');
    expect(codigos(c)).toEqual(expect.arrayContaining(['CONTRATO_LEGADO', 'CONTRATO_SEM_COMPENSACAO']));
  });

  it('carga da semana respeita jornada por dia', () => {
    const c = classificarCompensacao(esc({ diasSemana: [1, 2, 3, 4, 5, 6], jornadaPorDia: { '6': 240 } }), null, 'NENHUM', SEM);
    expect(c.escala?.cargaSemanaMin).toBe(5 * 480 + 240);
  });
});
