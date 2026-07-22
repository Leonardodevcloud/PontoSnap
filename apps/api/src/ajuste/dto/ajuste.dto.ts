import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SolicitarAjusteDto {
  @IsOptional() @IsString() empregadoId?: string;
  @IsIn(['INCLUSAO', 'DESCONSIDERAR']) tipo!: 'INCLUSAO' | 'DESCONSIDERAR';
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
