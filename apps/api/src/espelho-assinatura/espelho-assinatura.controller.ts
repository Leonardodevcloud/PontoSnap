import { Body, Controller, Get, Post, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { EspelhoAssinaturaService } from './espelho-assinatura.service';
import { TratamentoService } from '../tratamento/tratamento.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

const limitesDoMes = (competencia: string) => {
  const [a, m] = competencia.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
  return { inicio: `${competencia}-01`, fim: `${competencia}-${String(ultimo).padStart(2, '0')}` };
};

@Controller('espelho-assinatura')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EspelhoAssinaturaController {
  constructor(
    private readonly svc: EspelhoAssinaturaService,
    private readonly tratamento: TratamentoService,
  ) {}

  private tenantDe(u: PayloadAcesso): string {
    if (!u.tenantId) throw new Error('Sem tenant no token');
    return u.tenantId;
  }

  /** O funcionário vê se a competência já está assinada e se o espelho ainda casa. */
  @Get('status')
  @Perfis(Perfil.COLABORADOR)
  async status(@UsuarioAtual() u: PayloadAcesso, @Query('competencia') competencia: string) {
    const tenantId = this.tenantDe(u);
    const empregadoId = await this.svc.empregadoDoUsuario(tenantId, u.sub);
    return this.svc.status(tenantId, empregadoId, competencia);
  }

  /** O funcionário concorda e assina, validando o PIN. */
  @Post('assinar')
  @Perfis(Perfil.COLABORADOR)
  async assinar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: { competencia: string; pin: string }, @Req() req: { ip?: string }) {
    const tenantId = this.tenantDe(u);
    const empregadoId = await this.svc.empregadoDoUsuario(tenantId, u.sub);
    return this.svc.assinar(tenantId, empregadoId, dto.competencia, dto.pin, req.ip);
  }

  /** RH baixa o espelho de um funcionário; se assinado e conferindo, sai com o carimbo. */
  @Get('rh/pdf')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  async rhPdf(@UsuarioAtual() u: PayloadAcesso, @Query('empregadoId') empregadoId?: string, @Query('competencia') competencia?: string) {
    if (!u.tenantId) throw new Error('Sem tenant');
    if (!empregadoId || !competencia) throw new Error('Informe empregadoId e competencia (YYYY-MM)');
    const { inicio, fim } = limitesDoMes(competencia);
    const carimbo = await this.svc.paraCarimbo(u.tenantId, empregadoId, competencia);
    const r = await this.tratamento.gerarEspelhoPdf(u.tenantId, empregadoId, inicio, fim, carimbo);
    return new StreamableFile(r.buffer, { type: 'application/pdf', disposition: `attachment; filename="${r.nomeArquivo}"` });
  }
}
