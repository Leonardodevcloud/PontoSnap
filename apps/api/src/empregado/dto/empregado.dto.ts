import { IsBoolean, IsOptional, IsString, Matches, MinLength, MaxLength, IsUUID, IsNumber, Min, IsEmail, ValidateIf } from 'class-validator';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export class CriarEmpregadoDto {
  @Matches(/^\d{11}$/, { message: 'CPF deve ter 11 dígitos' }) cpf!: string;
  @IsString() @MinLength(2) nome!: string;
  @IsOptional() @IsString() matricula?: string;
  @IsOptional() @Matches(/^\d{4,8}$/, { message: 'PIN deve ter de 4 a 8 dígitos' }) pin?: string;
  @IsOptional() @Matches(/^\d{11}$/) pis?: string;
  @IsOptional() @IsNumber() @Min(0) salarioMensal?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data deve ser AAAA-MM-DD' }) dataInicioPonto?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(80) cargo?: string;
  @IsOptional() @Matches(DATA, { message: 'Admissão deve ser AAAA-MM-DD' }) dataAdmissao?: string;
  @IsOptional() @IsString() @MaxLength(120) cliente?: string;
  @IsOptional() @IsString() @MaxLength(120) chavePix?: string;
}

/**
 * Dados do cadastro que valem para todos os meses (aba Cadastro da ficha).
 * Campo ausente = não mexe; null ou vazio = apaga (menos o nome).
 * CPF não muda: está nas batidas já gravadas.
 */
export class AtualizarCadastroDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(52) nome?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(30) matricula?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) cargo?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Matches(DATA, { message: 'Admissão deve ser AAAA-MM-DD' }) dataAdmissao?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) cliente?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) chavePix?: string | null;
}

export class DefinirDataInicioPontoDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data deve ser AAAA-MM-DD' }) data?: string | null;
}

export class DefinirPinDto {
  @Matches(/^\d{4,8}$/, { message: 'PIN deve ter de 4 a 8 dígitos' }) pin!: string;
}

export class AtivoDto {
  @IsBoolean() ativo!: boolean;
}

export class DefinirHorarioDto {
  @IsUUID() horarioContratualId!: string;
}

export class DefinirSalarioDto {
  @IsNumber() @Min(0) salarioMensal!: number;
  /** YYYY-MM-DD a partir de quando vale. Obrigatório quando já existe salário. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) vigenteDesde?: string;
}

export class AcessoDto {
  @IsOptional() @IsEmail() email?: string;
}
