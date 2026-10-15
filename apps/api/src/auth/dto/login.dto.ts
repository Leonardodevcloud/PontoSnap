import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(180) email!: string;
  @IsString() @MinLength(8) senha!: string;
}

export class RefreshDto {
  @IsString() refreshToken!: string;
}

export class AlterarSenhaDto {
  /** Dispensada no primeiro acesso (quem já entrou com a senha provisória). */
  @IsOptional() @IsString() senhaAtual?: string;
  @IsString() @MinLength(8) senhaNova!: string;
}

export class RecuperarSenhaDto {
  @IsEmail() email!: string;
}

export class RedefinirSenhaDto {
  @IsString() @MinLength(10) token!: string;
  @IsString() @MinLength(8) senhaNova!: string;
}

export class TrocarEmpresaDto {
  @IsString() @IsNotEmpty() tenantId!: string;
}
