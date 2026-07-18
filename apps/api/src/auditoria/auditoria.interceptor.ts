import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { auditoria, comTenant, comoMaster, type Db } from '@ponto/db';
import type { PayloadAcesso } from '../auth/token';

/** Campos que nunca entram na trilha, por mais que venham no corpo. */
const SENSIVEIS = new Set([
  'senha', 'senhaAtual', 'senhaNova', 'senhaProvisoria', 'pin',
  'arquivoBase64', 'pfxBase64', 'arquivo',
]);

function limpar(corpo: unknown): unknown {
  if (!corpo || typeof corpo !== 'object') return corpo;
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(corpo as Record<string, unknown>)) {
    if (SENSIVEIS.has(k)) saida[k] = '«omitido»';
    else if (typeof v === 'string' && v.length > 200) saida[k] = `«${v.length} chars»`;
    else saida[k] = v;
  }
  return saida;
}

/**
 * Registra toda ação de escrita (POST/PATCH/PUT/DELETE) sem tocar nos
 * controllers. Um interceptor central não pode ser esquecido em endpoint novo —
 * é o que torna a trilha confiável em vez de cheia de buracos.
 *
 * A gravação é best-effort e fora da transação da requisição: auditar nunca
 * pode derrubar a ação que o usuário pediu.
 */
@Injectable()
export class AuditoriaInterceptor implements NestInterceptor {
  constructor(private readonly db: Db) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const metodo: string = req.method;

    // GET e OPTIONS não mudam estado — não sujam a trilha.
    if (metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS') {
      return next.handle();
    }

    const u: PayloadAcesso | undefined = req.usuario;
    const rota: string = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : req.url;
    const detalhe = limpar(req.body);
    const ip = (req.headers['x-forwarded-for']?.split(',')[0] ?? req.ip ?? '').slice(0, 45);

    const gravar = (statusHttp: string) => {
      const linha = {
        tenantId: u?.tenantId ?? null,
        usuarioId: u?.sub ?? null,
        usuarioEmail: u?.email ?? null,
        usuarioPerfil: u?.perfil ?? null,
        acao: `${metodo} ${rota}`.slice(0, 120),
        metodo, rota: rota.slice(0, 200),
        detalhe, statusHttp, ip,
      };
      // Fora do fluxo da resposta, reusando o RLS já existente.
      void (async () => {
        try {
          const inserir = (tx: Parameters<Parameters<Db['transaction']>[0]>[0]) =>
            tx.insert(auditoria).values(linha);
          if (u?.tenantId) await comTenant(this.db, u.tenantId, inserir);
          else await comoMaster(this.db, inserir);
        } catch {
          // Auditar nunca derruba a ação. Falha aqui é silenciosa por design.
        }
      })();
    };

    return next.handle().pipe(
      tap({
        next: () => gravar(String(ctx.switchToHttp().getResponse().statusCode ?? 200)),
        error: (e) => gravar(String(e?.status ?? 500)),
      }),
    );
  }
}
