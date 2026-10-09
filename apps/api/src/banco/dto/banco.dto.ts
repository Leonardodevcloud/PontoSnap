import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

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

export class FolgaDto {
  @IsUUID() empregadoId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data deve ser YYYY-MM-DD' }) data!: string;
  /** Opcional: horas em minutos. Ausente = usa a jornada do dia do funcionário. */
  @IsOptional() @IsInt() @Min(1) @Max(24 * 60) minutos?: number | null;
}

export class BaixaAberturaItemDto {
  @IsUUID() empregadoId!: string;
  @IsInt() @Min(1) @Max(100000) minutos!: number;
}

/** Baixa em lote do saldo de abertura já pago em dinheiro. */
export class BaixaAberturaDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'Mês da folha deve ser AAAA-MM' }) competenciaFolha!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => BaixaAberturaItemDto)
  itens!: BaixaAberturaItemDto[];
}
