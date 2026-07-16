import { IsBase64, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class EnviarDocumentoDto {
  @IsIn(['ATESTADO', 'COMPARECIMENTO']) tipo!: 'ATESTADO' | 'COMPARECIMENTO';
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dataInicio!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dataFim!: string;
  /** Ausente = dia inteiro. Preenchido = abono parcial (comparecimento). */
  @IsOptional() @IsInt() @Min(1) minutos?: number | null;
  @IsBase64() arquivoBase64!: string;
  @IsString() @MaxLength(120) arquivoNome!: string;
  @IsString() @MaxLength(60) arquivoMime!: string;
}

export class DecidirDto {
  @IsIn(['ABONADO', 'RECUSADO']) status!: 'ABONADO' | 'RECUSADO';
  @IsOptional() @IsString() @MaxLength(200) motivoRecusa?: string;
}
