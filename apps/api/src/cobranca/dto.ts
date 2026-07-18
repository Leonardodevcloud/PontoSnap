import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min, MinLength } from 'class-validator';

export class CriarPlanoDto {
  @IsString() @MinLength(2) nome!: string;
  @IsIn(['FIXO', 'POR_FUNCIONARIO']) modo!: 'FIXO' | 'POR_FUNCIONARIO';
  @IsNumber() @Min(0) valor!: number;
  @IsOptional() @IsString() descricao?: string;
}

export class DefinirAssinaturaDto {
  @IsOptional() @IsUUID() planoId?: string | null;
  @IsOptional() @IsIn(['FIXO', 'POR_FUNCIONARIO']) modoOverride?: 'FIXO' | 'POR_FUNCIONARIO' | null;
  @IsOptional() @IsNumber() @Min(0) valorOverride?: number | null;
  @IsInt() @Min(1) @Max(28) diaVencimento!: number;
  @IsOptional() @IsIn(['ativa', 'suspensa', 'cancelada']) situacao?: string;
}

export class GerarCobrancaDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'Competência deve ser AAAA-MM' }) competencia!: string;
}

export class AnexarBoletoDto {
  @IsString() @MinLength(4) boletoUrl!: string;
}
