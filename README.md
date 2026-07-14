# Ponto Eletrônico (REP-P) — SaaS Multi-Tenant

Sistema de registro eletrônico de ponto conforme **Portaria MTP 671/2021**.
Veja `ARCHITECTURE.md` para o desenho completo.

## Pacotes
- `packages/rep-core` — motor de conformidade (hash-chain, AFD, AEJ, comprovante). Puro, testado.
- `packages/shared` — tipos e enums compartilhados.

## Comandos
```
pnpm install
pnpm test        # roda os testes de todos os pacotes
pnpm typecheck
```
