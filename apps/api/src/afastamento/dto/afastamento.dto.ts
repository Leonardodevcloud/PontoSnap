import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { TIPOS, type TipoAfastamento } from '../afastamento.service';

export class CriarAfastamentoDto {
  @IsUUID() empregadoId!: string;
  @IsIn(TIPOS as unknown as string[]) tipo!: TipoAfastamento;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dataInicio!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dataFim!: string;
  @IsOptional() @IsString() @MaxLength(200) observacao?: string;
}
