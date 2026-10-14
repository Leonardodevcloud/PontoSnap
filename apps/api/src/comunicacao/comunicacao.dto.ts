import { IsArray, IsBoolean, IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, MaxLength, ArrayMaxSize } from 'class-validator';
import type { BlocoComunicado, PublicoComunicado } from '@ponto/db';

/** Comunicado montado no editor do RH. Os blocos são conferidos no serviço. */
export class SalvarComunicadoDto {
  @IsString() @MaxLength(160) titulo!: string;
  @IsArray() @ArrayMaxSize(20) blocos!: BlocoComunicado[];
  @IsObject() publico!: PublicoComunicado;
  @IsBoolean() pedirCiencia!: boolean;
  @IsBoolean() fixado!: boolean;
  @IsBoolean() notificar!: boolean;
  @IsBoolean() lembrar!: boolean;
  @IsBoolean() reacoes!: boolean;
  @IsOptional() @IsString() @MaxLength(160) autorNome?: string;
}

export class PublicarDto {
  /** Vazio = publica agora. */
  @IsOptional() @IsISO8601() agendadoPara?: string;
}

export class LembrarDto {
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) empregadoIds?: string[];
}

export class FixarDto { @IsBoolean() fixado!: boolean }
export class ArquivarDto { @IsBoolean() arquivar!: boolean }
export class VideoDto { @IsString() @MaxLength(500) url!: string }
export class ReacaoDto {
  @IsOptional() @IsIn(['👍', '❤️', '👏', '😂', '🙏', null]) reacao!: string | null;
}

export class VotoDto {
  @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) opcoes!: string[];
}
