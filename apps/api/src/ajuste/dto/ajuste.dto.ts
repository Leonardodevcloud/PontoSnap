import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class SolicitarAjusteDto {
  @IsOptional() @IsString() empregadoId?: string;
  @IsIn(['INCLUSAO', 'DESCONSIDERAR', 'CORRECAO']) tipo!: 'INCLUSAO' | 'DESCONSIDERAR' | 'CORRECAO';
  @Matches(/^\d{4}-\d{2}-\d{2}$/) data!: string;
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) hora?: string;
  @IsOptional() @IsIn(['E', 'S']) tpMarc?: 'E' | 'S';
  @IsOptional() @IsString() marcacaoId?: string;
  @IsOptional() @IsInt() nsr?: number;
  @IsString() @MinLength(5) @MaxLength(400) observacao!: string;
}

export class DecidirAjusteDto {
  @IsBoolean() aprovar!: boolean;
  @IsOptional() @IsString() @MaxLength(200) motivo?: string;
}

/** Folga concedida pelo RH: abona o dia sem mexer no banco de horas. */
export class FolgaConcedidaDto {
  @IsUUID() empregadoId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) data!: string;
  /** Folga por feriado trabalhado: a data do feriado. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) feriadoRef?: string | null;
  @IsOptional() @IsString() @MaxLength(200) motivo?: string | null;
}
