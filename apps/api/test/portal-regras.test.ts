import { describe, it, expect } from 'vitest';
import {
  conferir, detalheMei, detalheSemana, fimDaSemana, gerarCodigo, lerNfseXml, linkWhatsapp, maisUrgente, mascararPix, mensagemConvite, rotuloPeriodo, situacaoDe,
} from '../src/portal/regras';
import type { LinhaMei, LinhaMot, SemanaMot, LinhaDebito } from '../src/pessoal/pessoal.service';

const soma = (l: { valorCent: number; tipo?: string }[]) => l.reduce((a, x) => a + (x.tipo === 'MENOS' ? -x.valorCent : x.valorCent), 0);

describe('rótulos', () => {
  it('mês e semana', () => {
    expect(rotuloPeriodo('2026-10', 'MES')).toBe('Outubro/2026');
    expect(rotuloPeriodo('2026-10', '2026-10-27')).toBe('Semana 27/10 a 02/11');
    expect(fimDaSemana('2026-12-28')).toBe('2027-01-03');
  });
});

describe('como chegou no valor', () => {
  const mei = {
    id: 'm1', valorCent: 220000, heCent: 18000, feriadosCent: 0, faltasCent: 8462, debitosCent: 5538, metaDescontadaCent: 0,
    liquidoCent: 220000 + 18000 + 10000 - 8462 - 5538,
    lanc: { heMin: 360, faltas: 1, feriadosTrab: 0, metaCent: 10000 },
  } as unknown as LinhaMei;
  const debs = [{ pessoaId: 'm1', descricao: 'Adiantamento', parcelaAtual: 2, parcelas: 4, parcelaCent: 5538, tipo: 'PARCELADO' }] as LinhaDebito[];

  it('MEI: linhas fecham com o líquido', () => {
    const l = detalheMei(mei, debs, '2026-10');
    expect(l.map((x) => x.rotulo)).toEqual(['Contrato mensal', 'Horas extras (6h)', 'Meta de outubro', '1 falta', 'Adiantamento (parcela 2/4)']);
    expect(soma(l)).toBe(mei.liquidoCent);
  });
  it('MEI: diferença vira ajuste (nunca mostra conta que não bate)', () => {
    const l = detalheMei({ ...mei, liquidoCent: mei.liquidoCent + 1 } as LinhaMei, debs, '2026-10');
    expect(l.at(-1)!.rotulo).toBe('Ajuste de arredondamento');
    expect(soma(l)).toBe(mei.liquidoCent + 1);
  });
  it('motorista: dias × diária + adicional − débito da semana', () => {
    const m = { diariaCent: 10200 } as LinhaMot;
    const s = { dias: 6, totalCent: 61200 + 3000, adicionalCent: 3000, debitoAplicadoCent: 6000 } as SemanaMot;
    const l = detalheSemana(m, s);
    expect(l[0]!.rotulo).toBe('6 dias × R$ 102,00');
    expect(soma(l)).toBe(61200 + 3000 - 6000);
  });
});

describe('situação', () => {
  const n = (status: string, extra: Partial<{ confirmacao: string | null; resposta: string | null }> = {}) => ({ status, confirmacao: null, resposta: null, ...extra });
  it('mapeia status e contestação', () => {
    expect(situacaoDe(null, false)).toBe('NAO_LIBERADO');
    expect(situacaoDe(null, true)).toBe('RH');
    expect(situacaoDe(n('AGUARDANDO'), false)).toBe('FALTA');
    expect(situacaoDe(n('AGUARDANDO'), true)).toBe('RH');
    expect(situacaoDe(n('ENVIADA'), false)).toBe('CONFERIR');
    expect(situacaoDe(n('AGUARDANDO', { confirmacao: 'CONTESTOU' }), false)).toBe('CONTESTOU');
    expect(situacaoDe(n('AGUARDANDO', { confirmacao: 'CONTESTOU', resposta: 'ok' }), false)).toBe('FALTA');
  });
  it('a mais urgente vence', () => {
    expect(maisUrgente(['APROVADA', 'FALTA', 'CONFERIR'])).toBe('CONFERIR');
    expect(maisUrgente([])).toBe('NAO_LIBERADO');
  });
});

describe('NFS-e em XML', () => {
  const nacional = `<?xml version="1.0"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="x"><nNFSe>000127</nNFSe>
    <emit><CNPJ>01234567000189</CNPJ><xNome>JOAO</xNome></emit><valores><vLiq>1980.00</vLiq></valores>
    <DPS><infDPS><dhEmi>2026-11-02T10:00:00-03:00</dhEmi><prest><CNPJ>01234567000189</CNPJ></prest>
    <toma><CNPJ>12345678000190</CNPJ><xNome>IG</xNome></toma><serv><cServ><cTribNac>260101</cTribNac><xDescServ>Coleta e entrega  de outubro</xDescServ></cServ></serv><valores><vServPrest><vServ>1980.00</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`;
  const abrasf = `<CompNfse><Nfse><InfNfse><Numero>44</Numero><DataEmissao>2026-10-28T08:00:00</DataEmissao>
    <ValoresNfse><ValorLiquidoNfse>552.00</ValorLiquidoNfse></ValoresNfse>
    <PrestadorServico><IdentificacaoPrestador><CpfCnpj><Cnpj>11222333000144</Cnpj></CpfCnpj></IdentificacaoPrestador></PrestadorServico>
    <Servico><ItemListaServico>17.02</ItemListaServico><Discriminacao>Operador de caixa</Discriminacao></Servico><TomadorServico><IdentificacaoTomador><CpfCnpj><Cnpj>12345678000190</Cnpj></CpfCnpj></IdentificacaoTomador></TomadorServico></InfNfse></Nfse></CompNfse>`;
  it('padrão nacional', () => {
    expect(lerNfseXml(nacional)).toEqual({ numero: '127', data: '2026-11-02', valorCent: 198000, cnpjPrestador: '01234567000189', cnpjTomador: '12345678000190', codigoServico: '26.01.01', descricao: 'Coleta e entrega de outubro' });
  });
  it('ABRASF', () => {
    expect(lerNfseXml(abrasf)).toEqual({ numero: '44', data: '2026-10-28', valorCent: 55200, cnpjPrestador: '11222333000144', cnpjTomador: '12345678000190', codigoServico: '17.02', descricao: 'Operador de caixa' });
  });
});

describe('conferência automática', () => {
  const base = {
    mime: 'application/pdf', esperadoCent: 234000, competencia: '2026-10', periodo: 'MES',
    informado: { numero: '127', data: '2026-11-02', valorCent: 234000 }, lido: null,
    documentoPrestador: '01234567000189', cnpjTomador: '12345678000190', numerosAnteriores: ['119'],
  };
  it('PDF que bate', () => {
    const c = conferir(base);
    expect(c).toMatchObject({ arquivo: 'PDF', origem: 'INFORMADO', valorBate: true, numeroRepetido: false, competenciaOk: true, bate: true });
  });
  it('valor diferente, número repetido e data antes do mês derrubam', () => {
    expect(conferir({ ...base, informado: { ...base.informado, valorCent: 200000 } }).bate).toBe(false);
    expect(conferir({ ...base, numerosAnteriores: ['0127'] }).numeroRepetido).toBe(true);
    expect(conferir({ ...base, informado: { ...base.informado, data: '2026-09-30' } }).competenciaOk).toBe(false);
  });
  it('foto nunca vem marcada como "bate" (o RH olha)', () => {
    expect(conferir({ ...base, mime: 'image/jpeg' }).bate).toBe(false);
  });
  it('XML confere tomador e prestador', () => {
    const lido = { numero: '127', data: '2026-11-02', valorCent: 234000, cnpjPrestador: '01234567000189', cnpjTomador: '99999999000199' };
    const c = conferir({ ...base, mime: 'application/xml', lido });
    expect(c).toMatchObject({ origem: 'XML', tomadorOk: false, prestadorOk: true, bate: false });
  });
});

describe('convite', () => {
  it('código legível XXXX-XX', () => {
    const c = gerarCodigo((n) => Buffer.from(Array.from({ length: n }, (_, i) => i * 37)));
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{2}$/);
  });
  it('mensagem e WhatsApp', () => {
    const m = mensagemConvite('Diego Rocha', 'Auto Norte', 'https://x/c/ABCD-EF', 'diego@gmail.com');
    expect(m).toContain('Oi, Diego!');
    expect(m).toContain('Seu usuário é o seu e-mail: diego@gmail.com');
    expect(linkWhatsapp('(82) 99999-1234', 'oi')).toBe('https://wa.me/5582999991234?text=oi');
    expect(linkWhatsapp('123', 'oi')).toBeNull();
  });
  it('Pix mascarado', () => {
    expect(mascararPix('joao@gmail.com')).toBe('j•••@gmail.com');
    expect(mascararPix('12345678900')).toBe('•••8900');
  });
});
