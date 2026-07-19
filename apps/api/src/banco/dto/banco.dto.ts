import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, Max } from 'class-validator';

export class ConfigBancoDto {
  @IsIn(['NENHUM', 'INDIVIDUAL', 'COLETIVO']) tipoAcordo!: 'NENHUM' | 'INDIVIDUAL' | 'COLETIVO';
  @IsOptional() @IsInt() @Min(1) @Max(12) prazoMeses?: number | null;
}

export class MovimentoDto {
  @IsUUID() empregadoId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) data!: string;
  @IsInt() minutos!: number;
  @IsIn(['CREDITO', 'DEBITO', 'PAGAMENTO', 'AJUSTE']) tipo!: 'CREDITO' | 'DEBITO' | 'PAGAMENTO' | 'AJUSTE';
  @IsOptional() @IsString() @MaxLength(160) descricao?: string;
}

export class LancarCompetenciaDto {
  @IsUUID() empregadoId!: string;
  @Matches(/^\d{4}-\d{2}$/) competencia!: string;
}

export class LancarLoteDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'Competência deve ser YYYY-MM' }) competencia!: string;
}
