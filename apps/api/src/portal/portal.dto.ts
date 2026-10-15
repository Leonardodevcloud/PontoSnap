import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

const COMP = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export class AceitarConviteDto {
  @IsString() @MinLength(8) @MaxLength(100) senha!: string;
  @IsOptional() @IsString() @MaxLength(20) telefone?: string | null;
}

export class ConfirmarValorDto {
  @IsBoolean() confere!: boolean;
  @IsOptional() @IsString() @MaxLength(1000) motivo?: string | null;
}

export class EnviarNotaDto {
  @IsString() arquivoBase64!: string;
  @IsString() @MaxLength(160) arquivoNome!: string;
  @IsString() @MaxLength(80) arquivoMime!: string;
  @IsString() @MaxLength(60) numero!: string;
  @Matches(DATA) data!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber() @Min(0) valor?: number | null;
}

export class LerNotaDto {
  @IsString() arquivoBase64!: string;
  @IsString() @MaxLength(80) arquivoMime!: string;
}

export class FecharPessoaDto {
  @IsIn(['MEI', 'MOTORISTA']) pessoaTipo!: 'MEI' | 'MOTORISTA';
  @IsUUID() pessoaId!: string;
  @Matches(COMP) competencia!: string;
  @IsIn(['DESLIGAMENTO', 'ANTECIPADO']) motivo!: 'DESLIGAMENTO' | 'ANTECIPADO';
  @IsOptional() @Matches(DATA) ultimoDia?: string | null;
  @IsOptional() @IsBoolean() proporcional?: boolean;
  @IsOptional() @IsBoolean() liberarNota?: boolean;
  @IsOptional() @IsBoolean() cortarAcesso?: boolean;
  @IsOptional() @Matches(DATA) prazo?: string | null;
}

export class LiberarDto {
  @Matches(COMP) competencia!: string;
  @IsIn(['MEI', 'MOTORISTA']) tipo!: 'MEI' | 'MOTORISTA';
  @IsOptional() @IsArray() @ArrayMaxSize(6) @Matches(DATA, { each: true }) semanas?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true }) prestadorIds?: string[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATA) prazo?: string | null;
  @IsOptional() @IsBoolean() pedirConfirmacao?: boolean;
  @IsOptional() @IsBoolean() avisar?: boolean;
}

export class IdsDto {
  @IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true }) ids!: string[];
}

export class RecusarDto {
  @IsString() @MinLength(2) @MaxLength(500) motivo!: string;
}

export class ResponderDto {
  @IsString() @MinLength(2) @MaxLength(1000) resposta!: string;
}

export class LembrarNotasDto {
  @IsOptional() @Matches(COMP) competencia?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true }) notaIds?: string[];
}

export class ConvidarDto {
  @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) prestadorIds!: string[];
  @IsOptional() @IsBoolean() porEmail?: boolean;
}

export class AcessoDto {
  @IsBoolean() ativo!: boolean;
}

export class ContatoDto {
  @IsOptional() @IsString() @MaxLength(20) telefone?: string | null;
  @IsOptional() @IsString() @MaxLength(180) email?: string | null;
  @IsOptional() @IsString() @MaxLength(20) documento?: string | null;
  @IsOptional() @IsString() @MaxLength(160) tomadorNome?: string | null;
  @IsOptional() @IsString() @MaxLength(20) tomadorCnpj?: string | null;
}
