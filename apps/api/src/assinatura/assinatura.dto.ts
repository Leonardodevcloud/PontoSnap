import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const COMP = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export class ConfigAutentiqueDto {
  @IsOptional() @IsString() @MaxLength(400) token?: string | null;
  @IsOptional() @IsBoolean() sandbox?: boolean;
  @IsOptional() @IsBoolean() mostrarApp?: boolean;
  @IsOptional() @IsString() @MaxLength(200) webhookSegredo?: string | null;
}
export class ContrachequeDto {
  @Matches(COMP) competencia!: string;
  @IsUUID() empregadoId!: string;
  @IsString() arquivoBase64!: string;
  @IsString() @MaxLength(200) arquivoNome!: string;
}
export class LoteDto {
  @Matches(COMP) competencia!: string;
  @IsString() arquivoBase64!: string;
  @IsString() @MaxLength(200) arquivoNome!: string;
}
export class ItemLoteDto {
  @IsUUID() uploadId!: string;
  @IsOptional() @IsUUID() empregadoId?: string | null;
}
export class ConfirmarLoteDto {
  @Matches(COMP) competencia!: string;
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => ItemLoteDto) itens!: ItemLoteDto[];
}
export class EnviarDto {
  @Matches(COMP) competencia!: string;
  @IsArray() @ArrayMaxSize(1000) @IsUUID('all', { each: true }) empregadoIds!: string[];
  @IsOptional() @IsIn(['AUTO', 'APP']) canal?: 'AUTO' | 'APP';
  @IsOptional() @IsString() @MaxLength(1000) mensagem?: string | null;
  @IsOptional() @IsIn(['DAILY', 'WEEKLY', null]) lembrete?: 'DAILY' | 'WEEKLY' | null;
  @IsOptional() @Matches(DATA) prazo?: string | null;
}
export class IdsDocsDto {
  @IsArray() @ArrayMaxSize(1000) @IsUUID('all', { each: true }) ids!: string[];
}
