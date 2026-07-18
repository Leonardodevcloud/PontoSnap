import { IsBoolean, IsEnum, IsISO8601, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Coletor } from '@ponto/shared';

export class BaterDto {
  @IsOptional() @IsEnum(Coletor) coletor?: Coletor;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  /** Contexto que o funcionário dá quando bate fora do raio. Nunca é permissão. */
  @IsOptional() @IsString() @MaxLength(200) observacao?: string;
  /** Hora do relógio do aparelho (ISO), quando a batida foi capturada offline. */
  @IsOptional() @IsISO8601() dtAparelho?: string;
  /** O app declara que capturou sem rede. */
  @IsOptional() @IsBoolean() declaradoOffline?: boolean;
}

export class LocalDto {
  @IsOptional() @IsNumber() latitude?: number | null;
  @IsOptional() @IsNumber() longitude?: number | null;
  @IsOptional() @IsNumber() raioMetros?: number | null;
  @IsOptional() @IsString() @MaxLength(200) localPrestacao?: string;
}
