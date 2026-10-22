import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CriarUsuarioDto {
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsEmail({}, { message: 'E-mail inválido' }) @MaxLength(180) email!: string;
  @IsIn(['ADMIN_CLIENTE', 'RH']) perfil!: 'ADMIN_CLIENTE' | 'RH';
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) empresas?: string[];
  @IsOptional() @IsBoolean() enviar?: boolean;
}
export class EditarUsuarioDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) nome?: string;
  @IsOptional() @IsIn(['ADMIN_CLIENTE', 'RH']) perfil?: 'ADMIN_CLIENTE' | 'RH';
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) empresas?: string[];
}
export class EmailUsuarioDto {
  @IsEmail({}, { message: 'E-mail inválido' }) @MaxLength(180) email!: string;
  @IsOptional() @IsBoolean() reenviar?: boolean;
}
export class AtivoUsuarioDto { @IsBoolean() ativo!: boolean; }
