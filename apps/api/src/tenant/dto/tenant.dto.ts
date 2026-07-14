import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CriarTenantDto {
  @Matches(/^\d{14}$/, { message: 'CNPJ deve ter 14 dígitos' }) cnpj!: string;
  @IsString() @MinLength(2) razaoSocial!: string;
  @IsOptional() @IsString() localPrestacao?: string;
  @IsEmail() adminEmail!: string;
  @IsString() @MinLength(8) adminSenha!: string;
}

export class AtivoDto {
  @IsBoolean() ativo!: boolean;
}
