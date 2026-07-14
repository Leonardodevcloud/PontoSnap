import { IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

export class CriarHorarioDto {
  @IsString() codigo!: string;
  @IsInt() @Min(1) durJornadaMin!: number;
  @IsArray() pares!: { entrada: string; saida: string }[];
  @IsOptional() @IsArray() diasSemana?: number[]; // 0=dom ... 6=sáb; padrão seg–sex
  @IsOptional() @IsString() regime?: string; // 'normal' | 'r12x36'
}

export class CriarAusenciaDto {
  @IsUUID() empregadoId!: string;
  @IsInt() @Min(1) @Max(4) tipo!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) data!: string;
  @IsOptional() @IsInt() qtMinutos?: number;
  @IsOptional() @IsInt() tipoMovBh?: number;
}

export class CriarTratamentoDto {
  @IsUUID() empregadoId!: string;
  @IsString() dtMarcacao!: string;
  @Matches(/^[ESD]$/) tpMarc!: string;
  @IsInt() @Min(1) seqEntSaida!: number;
  @IsOptional() @Matches(/^[OIPXT]$/) fonteMarc?: string;
  @IsOptional() @IsString() codHorContratual?: string;
  @IsOptional() @IsString() motivo?: string;
}

export class ApurarDto {
  @IsUUID() empregadoId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) data!: string;
}
