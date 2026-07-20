import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

export class CctDto {
  @IsString() @MaxLength(120) nome!: string;
  @IsOptional() @IsString() @Length(2, 2) uf?: string | null;
  @IsOptional() @IsString() @MaxLength(60) vigencia?: string | null;

  @IsInt() @Min(0) @Max(300) extraDiaUtilPct!: number;
  @IsInt() @Min(0) @Max(300) extraDomingoFeriadoPct!: number;
  @IsInt() @Min(0) @Max(24 * 60) extraLimiteDiarioMin!: number;

  @IsInt() @Min(0) @Max(120) toleranciaDiariaMin!: number;
  @IsInt() @Min(0) @Max(60) toleranciaPorMarcacaoMin!: number;

  @IsInt() @Min(0) @Max(200) noturnoAdicionalPct!: number;
  @IsBoolean() noturnoReduzida!: boolean;
  @IsInt() @Min(0) @Max(24 * 60) noturnoInicioMin!: number;
  @IsInt() @Min(0) @Max(24 * 60) noturnoFimMin!: number;

  @IsInt() @Min(0) @Max(60 * 60) jornadaSemanalMin!: number;
  @IsInt() @Min(0) @Max(24 * 60) interjornadaMinimaMin!: number;
  @IsInt() @Min(0) @Max(24 * 60) intervaloMaior6hMin!: number;

  @IsOptional() @IsInt() @Min(1) @Max(12) bancoPrazoMeses?: number | null;
}

export class VincularCctDto {
  @IsOptional() @IsString() cctId?: string | null;
}

export class ExtrairCctDto {
  @IsString() arquivoBase64!: string;
}
