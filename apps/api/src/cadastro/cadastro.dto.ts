import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, Max, IsUUID } from 'class-validator';

/** Atualização cadastral feita pelo próprio funcionário no app. */
export class MeuCadastroDto {
  /** JPEG 320×320 em base64 (sem o prefixo data:). Opcional se já tem foto válida. */
  @IsOptional() @IsString() @MaxLength(600_000) foto?: string;
  /** JPEG 96×96 em base64: vai nas listas. */
  @IsOptional() @IsString() @MaxLength(80_000) miniatura?: string;
  @IsOptional() @IsIn(['CAMERA', 'GALERIA']) origem?: 'CAMERA' | 'GALERIA';
  @IsOptional() @IsString() @MaxLength(20) @Matches(/^[\d\s()+-]*$/, { message: 'Celular: use só números' }) celular?: string;
  @IsOptional() @IsString() @MaxLength(160) emailPessoal?: string;
  @IsOptional() @IsString() @MaxLength(160) contatoEmergencia?: string;
}

export class RecusarFotoDto {
  @IsString() @MaxLength(200) motivo!: string;
}

export class SementeAvatarDto {
  @IsIn(['CLT', 'PRESTADOR']) tipo!: 'CLT' | 'PRESTADOR';
  @IsUUID() id!: string;
  @IsInt() @Min(0) @Max(1_000_000) semente!: number;
}
