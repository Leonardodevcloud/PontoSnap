import { IsArray, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ArgosPerguntaDto {
  @IsString() @MaxLength(2000) pergunta!: string;
  @IsOptional() @IsString() empregadoId?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) mes?: string | null;
  @IsOptional() @IsArray() historico?: { pergunta: string; resposta: string }[];
}
