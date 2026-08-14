import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SalvarPerfilDto {
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  /** { extra?, tolerancia?, noturno?, jornada?, banco?, destinacao? } */
  @IsObject() config!: Record<string, unknown>;
  @IsOptional() @IsBoolean() padrao?: boolean;
  // convenção coletiva opcional
  @IsOptional() @IsString() cctSindicato?: string;
  @IsOptional() @IsString() cctVigencia?: string;
  @IsOptional() @IsString() cctRegistroMte?: string;
  @IsOptional() @IsString() cctPdfNome?: string;
  @IsOptional() @IsString() cctPdfBase64?: string;
}

export class DefinirPerfilDto {
  @IsOptional() @IsString() perfilRegraId?: string | null;
}
