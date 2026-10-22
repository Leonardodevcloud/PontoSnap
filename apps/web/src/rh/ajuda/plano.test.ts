import { describe, expect, it } from 'vitest';
import type { Horario } from '../../tipos';
import { canon, configAlvo, escalaAlvo, perfilAlvo, type Respostas } from './plano';

const R: Respostas = { jornada: 'CARGA', comp: 'MES', faltas: 'BANCO', negativo: 'DESCONTA', acordo: 'INDIVIDUAL', prazo: 6 };
const h = (o: Partial<Horario>): Horario => ({ id: 'x', codigo: 'COM-0817', durJornadaMin: 480, pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }], diasSemana: [1, 2, 3, 4, 5], regime: 'normal', flexivel: false, compensaSemana: false, ...o });

describe('assistente de compensação', () => {
  it('canon ignora ordem das chaves', () => {
    expect(canon({ a: 1, b: { c: 2, d: [1] } })).toBe(canon({ b: { d: [1], c: 2 }, a: 1 }));
  });

  it('config mantém extra/tolerância e troca banco e destino, tirando o contrato antigo', () => {
    const c = configAlvo({ extra: { extraDiaUtilPct: 60 }, contrato: { tipoJornada: 'CONTRATO_HORAS' }, banco: null }, R);
    expect(c).toMatchObject({ extra: { extraDiaUtilPct: 60 }, banco: { bancoModo: 'ATIVO', formaCalculo: 'INTRA_MES' }, destinacao: { destinacaoFaltas: 'BANCO', destinacaoAtrasos: 'BANCO' } });
    expect('contrato' in c).toBe(false);
  });

  it('reaproveita perfil igual e cria um novo com nome derivado quando não há', () => {
    const atual = { id: 'p1', nome: 'Operação', padrao: true, config: { banco: null } };
    const r1 = perfilAlvo(atual, R, [atual]);
    expect('novo' in r1 && r1.novo.nome).toBe('Operação · compensa no mês');
    const pronto = { id: 'p2', nome: 'Comercial', padrao: false, config: configAlvo(atual.config, R) };
    const r2 = perfilAlvo(atual, R, [atual, pronto]);
    expect('existente' in r2 && r2.existente.id).toBe('p2');
  });

  it('não compensa / semana desligam o banco explicitamente', () => {
    expect(configAlvo({}, { ...R, comp: 'SEMANA' })).toMatchObject({ banco: { bancoModo: 'INATIVO' }, destinacao: { destinacaoFaltas: 'DESCONTA' } });
  });

  it('escala: usa a base se já serve, acha uma igual ou cria variação com código livre', () => {
    const base = h({ id: 'b' });
    expect(escalaAlvo(base, { ...R, jornada: 'FIXO', comp: 'MES' }, [base])).toEqual({ existente: base });
    const ch = h({ id: 'c', codigo: 'CH-8H', flexivel: true, pares: [] });
    expect(escalaAlvo(base, R, [base, ch])).toEqual({ existente: ch });
    const r = escalaAlvo(base, { ...R, comp: 'SEMANA' }, [base, h({ id: 'd', codigo: 'COM-0817 CH SEM' })]);
    expect('nova' in r && r.nova).toMatchObject({ codigo: 'COM-0817 CH SEM2', flexivel: true, compensaSemana: true, durJornadaMin: 480 });
    const flex = h({ id: 'f', codigo: 'CH-8H', flexivel: true, pares: [] });
    const r2 = escalaAlvo(flex, { ...R, comp: 'SEMANA' }, [flex]);
    expect('nova' in r2 && r2.nova.codigo).toBe('CH-8H SEM');
  });

  it('de contrato de horas para fixo: usa um fixo com a mesma carga, ou pede um horário', () => {
    const flex = h({ id: 'f', codigo: 'CH-8H', flexivel: true, pares: [] });
    const fixo = h({ id: 'x2' });
    expect(escalaAlvo(flex, { ...R, jornada: 'FIXO' }, [flex, fixo])).toEqual({ existente: fixo });
    expect(escalaAlvo(flex, { ...R, jornada: 'FIXO' }, [flex])).toEqual({ semHorario: flex });
  });

  it('dias ou carga diferentes não servem; 12x36 não é variada', () => {
    const base = h({ id: 'b' });
    const outra = h({ id: 'o', diasSemana: [1, 2, 3, 4, 5, 6], flexivel: true });
    expect('nova' in escalaAlvo(base, R, [base, outra])).toBe(true);
    const doze = h({ id: 'z', regime: 'r12x36' });
    expect(escalaAlvo(doze, R, [doze])).toEqual({ doze });
  });
});
