# PontoSnap API — imagem de produção (Railway)
#
# Duas decisões importantes aqui:
#
# 1) BUILD REAL COM TSC. O NestJS depende de "emitDecoratorMetadata" para a
#    injeção de dependência e para o ValidationPipe saber o tipo dos DTOs.
#    Transpiladores baseados em esbuild (tsx) NÃO emitem esses metadados: a API
#    sobe, mas os controllers ficam sem dependência e os DTOs deixam de ser
#    validados silenciosamente. Por isso compilamos com tsc de verdade.
#
# 2) node-linker=hoisted. O dist/ compilado embute os packages do monorepo e
#    requer as libs deles (pdfkit, postgres, node-forge...). Com o node_modules
#    isolado do pnpm, dist/packages/**/*.js não enxerga essas libs. O layout
#    achatado resolve isso dentro da imagem, sem afetar o ambiente local.
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

RUN printf "node-linker=hoisted\n" > .npmrc

# 1) Manifestos primeiro: aproveita o cache de camada entre deploys
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.build.json ./
COPY packages/shared/package.json       ./packages/shared/
COPY packages/rep-core/package.json     ./packages/rep-core/
COPY packages/apuracao-clt/package.json ./packages/apuracao-clt/
COPY packages/db/package.json           ./packages/db/
COPY apps/api/package.json              ./apps/api/
COPY apps/web/package.json              ./apps/web/

# instala a API, o db e a raiz (typescript do build). O front não entra na imagem.
RUN pnpm install --frozen-lockfile \
      --filter @ponto/api... \
      --filter @ponto/db... \
      --filter ponto-eletronico

# 2) Código-fonte e build
COPY packages ./packages
COPY apps/api ./apps/api
COPY scripts ./scripts
RUN pnpm build:api

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/apps/api/src/main.js"]
