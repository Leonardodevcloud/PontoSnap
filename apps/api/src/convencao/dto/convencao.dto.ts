import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class ConvencaoDto {
  @IsString() @MaxLength(140) nome!: string;
  @IsOptional() @IsString() @MaxLength(140) sindicato?: string | null;
  @IsOptional() @IsString() @Length(2, 2) uf?: string | null;
  @IsOptional() @IsString() @MaxLength(60) vigencia?: string | null;
  @IsOptional() @IsString() @MaxLength(60) numeroRegistroMte?: string | null;
  @IsOptional() @IsString() @MaxLength(140) categoria?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) observacoes?: string | null;
  /** PDF em base64 (opcional). Guardado pra fins de documento e pra IA reler. */
  @IsOptional() @IsString() pdfBase64?: string | null;
  @IsOptional() @IsString() @MaxLength(200) pdfNome?: string | null;
}

export class VincularConvencaoDto {
  @IsOptional() @IsString() convencaoId?: string | null;
}
