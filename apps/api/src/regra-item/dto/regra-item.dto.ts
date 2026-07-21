import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

const TIPOS = ['EXTRA', 'TOLERANCIA', 'NOTURNO', 'JORNADA', 'BANCO', 'DESTINACAO'];

export class RegraItemDto {
  @IsIn(TIPOS) tipo!: 'EXTRA' | 'TOLERANCIA' | 'NOTURNO' | 'JORNADA' | 'BANCO' | 'DESTINACAO';
  @IsString() @MaxLength(120) nome!: string;
  @IsObject() config!: Record<string, unknown>;
  @IsBoolean() padrao!: boolean;
}

export class RegraItemEditDto {
  @IsString() @MaxLength(120) nome!: string;
  @IsObject() config!: Record<string, unknown>;
  @IsBoolean() padrao!: boolean;
}

export class MontarRegrasDto {
  @IsOptional() @IsString() regraExtraId?: string | null;
  @IsOptional() @IsString() regraToleranciaId?: string | null;
  @IsOptional() @IsString() regraNoturnoId?: string | null;
  @IsOptional() @IsString() regraJornadaId?: string | null;
  @IsOptional() @IsString() regraBancoId?: string | null;
  @IsOptional() @IsString() regraDestinacaoId?: string | null;
}
