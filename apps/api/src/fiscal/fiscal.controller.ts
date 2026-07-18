import { BadRequestException, Controller, Get, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { FiscalService, type Periodo } from './fiscal.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

@Controller('fiscal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}
  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }
  private periodo(inicio?: string, fim?: string): Periodo {
    // YYYY-MM-DD é interpretado no fuso de Brasília, cobrindo o dia inteiro.
    // Sem isso, new Date('2026-07-16') vira meia-noite UTC = 21h do dia anterior
    // em -0300, e batidas do fim do dia ficam de fora do arquivo fiscal.
    return {
      inicio: inicio ? new Date(`${inicio}T00:00:00-0300`) : undefined,
      fim: fim ? new Date(`${fim}T23:59:59-0300`) : undefined,
    };
  }
  private arquivo(conteudo: Buffer, nome: string, tipo = 'text/plain') {
    return new StreamableFile(conteudo, { type: tipo, disposition: `attachment; filename="${nome}"` });
  }

  @Get('afd') async afd(@UsuarioAtual() u: PayloadAcesso, @Query('inicio') i?: string, @Query('fim') f?: string) {
    const r = await this.fiscal.gerarAfd(this.tenant(u), this.periodo(i, f));
    return this.arquivo(r.conteudo, r.nomeArquivo);
  }
  @Get('afd/p7s') async afdP7s(@UsuarioAtual() u: PayloadAcesso, @Query('inicio') i?: string, @Query('fim') f?: string) {
    const r = await this.fiscal.gerarAfdAssinado(this.tenant(u), this.periodo(i, f));
    return this.arquivo(r.p7s, r.nomeP7s, 'application/pkcs7-signature');
  }
  @Get('aej') async aej(@UsuarioAtual() u: PayloadAcesso, @Query('inicio') i?: string, @Query('fim') f?: string) {
    const r = await this.fiscal.gerarAej(this.tenant(u), this.periodo(i, f));
    return this.arquivo(r.conteudo, r.nomeArquivo);
  }
  @Get('aej/p7s') async aejP7s(@UsuarioAtual() u: PayloadAcesso, @Query('inicio') i?: string, @Query('fim') f?: string) {
    const r = await this.fiscal.gerarAejAssinado(this.tenant(u), this.periodo(i, f));
    return this.arquivo(r.p7s, r.nomeP7s, 'application/pkcs7-signature');
  }
}
