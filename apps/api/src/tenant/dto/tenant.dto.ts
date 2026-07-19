import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';

/** Offsets fixos do Brasil (sem horário de verão desde 2019). */
export const FUSOS_BR = ['-0200', '-0300', '-0400', '-0500'] as const;

export class CriarTenantDto {
  @Matches(/^\d{14}$/, { message: 'CNPJ deve ter 14 dígitos' }) cnpj!: string;
  @IsString() @MinLength(2) razaoSocial!: string;
  @IsOptional() @IsString() localPrestacao?: string;
  @IsOptional() @IsIn(FUSOS_BR, { message: 'Fuso inválido' }) fuso?: string;
  @IsEmail() adminEmail!: string;
  @IsString() @MinLength(8) adminSenha!: string;
}

export class AtivoDto {
  @IsBoolean() ativo!: boolean;
}

export class FusoDto {
  @IsIn(FUSOS_BR, { message: 'Fuso inválido' }) fuso!: string;
}
