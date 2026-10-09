import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const COMP = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS = ['CLT', 'MEI', 'MOTORISTA'];

export class ConfigCltDto {
  @IsOptional() @IsString() @MaxLength(80) cargo?: string | null;
  @Type(() => Number) @IsNumber() @Min(0) vrDia!: number;
  @Type(() => Number) @IsNumber() @Min(0) cestaMensal!: number;
  @IsIn(['NENHUM', 'DIA', 'FIXO']) vtTipo!: 'NENHUM' | 'DIA' | 'FIXO';
  @Type(() => Number) @IsNumber() @Min(0) vtValor!: number;
  @IsOptional() @IsString() @MaxLength(120) chavePix?: string | null;
  /** Mês do benefício a partir do qual o valor vale (meses anteriores não mudam). */
  @Matches(COMP) vigenteDesde!: string;
  /** true = a partir de vigenteDesde segue o padrão da empresa. */
  @IsOptional() @IsBoolean() usaPadrao?: boolean;
}

export class PadraoDto {
  @Type(() => Number) @IsNumber() @Min(0) vrDia!: number;
  @Type(() => Number) @IsNumber() @Min(0) cestaMensal!: number;
  @IsIn(['NENHUM', 'DIA', 'FIXO']) vtTipo!: 'NENHUM' | 'DIA' | 'FIXO';
  @Type(() => Number) @IsNumber() @Min(0) vtValor!: number;
  @Matches(COMP) vigenteDesde!: string;
}

export class CriarPrestadorDto {
  @IsIn(['MEI', 'MOTORISTA']) tipo!: 'MEI' | 'MOTORISTA';
  @IsString() @MaxLength(80) nome!: string;
  @IsOptional() @IsString() @MaxLength(20) documento?: string | null;
  @IsOptional() @IsString() @MaxLength(80) funcao?: string | null;
  @IsOptional() @IsString() @MaxLength(120) empresa?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Matches(DATA) inicioAtividade?: string | null;
  @Type(() => Number) @IsNumber() @Min(0) valorMensal!: number;
  @IsIn(['SEG_SAB', 'SEG_SEX']) baseDias!: 'SEG_SAB' | 'SEG_SEX';
  @IsOptional() @IsString() @MaxLength(120) chavePix?: string | null;
  @Matches(COMP) competenciaInicio!: string;
}

export class EditarPrestadorDto {
  @IsOptional() @IsString() @MaxLength(80) nome?: string;
  @IsOptional() @IsString() @MaxLength(20) documento?: string | null;
  @IsOptional() @IsString() @MaxLength(80) funcao?: string | null;
  @IsOptional() @IsString() @MaxLength(120) empresa?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Matches(DATA) inicioAtividade?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) valorMensal?: number;
  @IsOptional() @IsIn(['SEG_SAB', 'SEG_SEX']) baseDias?: 'SEG_SAB' | 'SEG_SEX';
  @IsOptional() @IsString() @MaxLength(120) chavePix?: string | null;
  /** Obrigatório quando muda valor ou base: o reajuste vale a partir deste mês. */
  @IsOptional() @Matches(COMP) vigenteDesde?: string;
}

export class LancamentoDto {
  @IsIn(TIPOS) pessoaTipo!: 'CLT' | 'MEI' | 'MOTORISTA';
  @IsUUID() pessoaId!: string;
  @Matches(COMP) competencia!: string;
  @IsOptional() @Matches(/^(MES|\d{4}-\d{2}-\d{2})$/) periodo?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) heMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(31) faltas?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(31) feriadosTrab?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(7) dias?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) adicional?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) meta?: number;
  @IsOptional() @IsBoolean() metaPaga?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Matches(DATA) metaPagaEm?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber() @Min(0) valorPago?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) debitoAplicado?: number;
  @IsOptional() @IsString() @MaxLength(60) nfNumero?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Matches(DATA) nfData?: string | null;
  @IsOptional() @IsBoolean() pago?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) observacao?: string | null;
}

export class ExclusaoDto {
  @IsIn(TIPOS) pessoaTipo!: 'CLT' | 'MEI' | 'MOTORISTA';
  @IsUUID() pessoaId!: string;
  @Matches(COMP) competencia!: string;
  @IsIn(['MES', 'DIANTE']) escopo!: 'MES' | 'DIANTE';
}

export class DebitoDto {
  @IsIn(TIPOS) pessoaTipo!: 'CLT' | 'MEI' | 'MOTORISTA';
  @IsUUID() pessoaId!: string;
  @IsString() @MaxLength(120) descricao!: string;
  @Type(() => Number) @IsNumber() @Min(0.01) valorTotal!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(60) parcelas!: number;
  @Matches(COMP) competenciaInicio!: string;
}

export class CompetenciaDto {
  @Matches(COMP) competencia!: string;
}

export class InicioCestaDto {
  /** YYYY-MM a partir do qual a cesta é paga. null = automático (3 meses após o início no ponto). */
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(COMP) cestaDesde!: string | null;
}

export class NfArquivoDto {
  @IsIn(['MEI', 'MOTORISTA']) pessoaTipo!: 'MEI' | 'MOTORISTA';
  @IsUUID() pessoaId!: string;
  @Matches(COMP) competencia!: string;
  @IsOptional() @Matches(/^(MES|\d{4}-\d{2}-\d{2})$/) periodo?: string;
  @IsString() arquivoBase64!: string;
  @IsString() @MaxLength(160) arquivoNome!: string;
  @IsString() @MaxLength(80) arquivoMime!: string;
}

export class PagamentoDto {
  @IsIn(['MEI', 'MOTORISTA']) pessoaTipo!: 'MEI' | 'MOTORISTA';
  @IsUUID() pessoaId!: string;
  @Matches(COMP) competencia!: string;
  @IsBoolean() pago!: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber() @Min(0) valorPago?: number | null;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(6) semanas?: string[];
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) periodo?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) debitoAplicado?: number;
}

export class AdmissaoDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATA) dataAdmissao!: string | null;
}
