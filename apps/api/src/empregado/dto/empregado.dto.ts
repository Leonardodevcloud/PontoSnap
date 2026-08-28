import { IsBoolean, IsOptional, IsString, Matches, MinLength, IsUUID, IsNumber, Min, IsEmail } from 'class-validator';

export class CriarEmpregadoDto {
  @Matches(/^\d{11}$/, { message: 'CPF deve ter 11 dígitos' }) cpf!: string;
  @IsString() @MinLength(2) nome!: string;
  @IsOptional() @IsString() matricula?: string;
  @IsOptional() @Matches(/^\d{4,8}$/, { message: 'PIN deve ter de 4 a 8 dígitos' }) pin?: string;
  @IsOptional() @Matches(/^\d{11}$/) pis?: string;
  @IsOptional() @IsNumber() @Min(0) salarioMensal?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data deve ser AAAA-MM-DD' }) dataInicioPonto?: string;
  @IsOptional() @IsEmail() email?: string;
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
}

export class AcessoDto {
  @IsOptional() @IsEmail() email?: string;
}
