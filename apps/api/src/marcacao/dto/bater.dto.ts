import { IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Coletor } from '@ponto/shared';

export class BaterDto {
  @IsOptional() @IsEnum(Coletor) coletor?: Coletor;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  /** Contexto que o funcionário dá quando bate fora do raio. Nunca é permissão. */
  @IsOptional() @IsString() @MaxLength(200) observacao?: string;
}

export class LocalDto {
  @IsOptional() @IsNumber() latitude?: number | null;
  @IsOptional() @IsNumber() longitude?: number | null;
  @IsOptional() @IsNumber() raioMetros?: number | null;
  @IsOptional() @IsString() @MaxLength(200) localPrestacao?: string;
}
