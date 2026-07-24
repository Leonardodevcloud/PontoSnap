import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';

/** Offsets fixos do Brasil (sem horário de verão desde 2019). */
export const FUSOS_BR = ['-0200', '-0300', '-0400', '-0500'] as const;

export class CriarTenantDto {
  @Matches(/^\d{14}$/, { message: 'CNPJ deve ter 14 dígitos' }) cnpj!: string;
  @IsString() @MinLength(2) razaoSocial!: string;
  @IsOptional() @IsString() localPrestacao?: string;
  @IsOptional() @IsIn(FUSOS_BR, { message: 'Fuso inválido' }) fuso?: string;
  // Caminho A — cliente novo. A senha é gerada pelo sistema e vai por e-mail.
  @IsOptional() @IsEmail() adminEmail?: string;
  @IsOptional() @IsString() adminNome?: string;
  // Caminho B — outra empresa de um cliente que já existe.
  @IsOptional() @IsString() usuarioExistenteId?: string;
  @IsOptional() @IsIn(['ADMIN_CLIENTE', 'RH']) perfilNaEmpresa?: 'ADMIN_CLIENTE' | 'RH';
}

export class AtivoDto {
  @IsBoolean() ativo!: boolean;
}

export class FusoDto {
  @IsIn(FUSOS_BR, { message: 'Fuso inválido' }) fuso!: string;
}

export class VincularEmpresaDto {
  @IsString() usuarioId!: string;
  @IsString() tenantId!: string;
  @IsIn(['ADMIN_CLIENTE', 'RH']) perfil!: 'ADMIN_CLIENTE' | 'RH';
}
