import { describe, it, expect } from 'vitest';
import { jornadaFlexivel } from '../src/tratamento/montar-regras';

describe('jornadaFlexivel (contrato de horas)', () => {
  it('perfil CONTRATO_HORAS manda, mesmo com escala fixa', () => {
    expect(jornadaFlexivel({ contrato: { tipoJornada: 'CONTRATO_HORAS' } }, { flexivel: false })).toBe(true);
  });
  it('perfil FIXO manda, mesmo com escala marcada flexível', () => {
    expect(jornadaFlexivel({ contrato: { tipoJornada: 'FIXO' } }, { flexivel: true })).toBe(false);
  });
  it('perfil sem definição segue a escala (legado)', () => {
    expect(jornadaFlexivel({}, { flexivel: true })).toBe(true);
    expect(jornadaFlexivel({ contrato: null }, { flexivel: false })).toBe(false);
    expect(jornadaFlexivel({}, null)).toBe(false);
  });
});
