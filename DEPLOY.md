# Deploy — Railway (API + Postgres) e Vercel (front)

Guia direto ao ponto. Leia primeiro a seção **⚠️ Isolamento entre clientes**: ela é a
diferença entre um SaaS multi-tenant seguro e um vazamento de dados entre empresas.

---

## ⚠️ Isolamento entre clientes (leia antes de tudo)

O isolamento entre tenants é feito por **Row-Level Security** no PostgreSQL.
O PostgreSQL **não aplica RLS a superusuários**. O usuário padrão do Railway/Neon é
justamente o admin — se a API conectar com ele, **um cliente enxerga os dados do outro**.

Isso não é teoria. Testado contra Postgres real, com o tenant do Cliente A fixado na sessão:

| Role usado pela API | O que enxergou |
|---|---|
| `postgres` (admin, superusuário) | `['Joao (Cliente B)', 'Maria (Cliente A)']` ← **vazou** |
| `ponto_app` (NOSUPERUSER NOBYPASSRLS) | `['Maria (Cliente A)']` ← correto |

**Regra:** migrations rodam com o **admin**; a API conecta com o **role restrito**.

---

## 1. Banco (Railway Postgres)

1. No projeto do Railway: **+ New → Database → PostgreSQL**.
2. Abra o Postgres → aba **Data/Connect** → copie a `DATABASE_URL` (é o admin).
3. Crie o role restrito. Conecte com o admin (psql, TablePlus, ou a aba Query do Railway) e rode
   [`packages/db/scripts/setup-role.sql`](packages/db/scripts/setup-role.sql) — **troque a senha antes**.

   > Rode esse script **depois** do primeiro deploy (que cria as tabelas via migration).
   > Ele já concede permissão para as tabelas futuras via `ALTER DEFAULT PRIVILEGES`.

4. Confira (deve voltar `false, false`):
   ```sql
   SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'ponto_app';
   ```

---

## 2. API (Railway)

1. **+ New → GitHub Repo** → selecione este repositório.
   O Railway detecta o `Dockerfile` da raiz e o `railway.json` (build, start, healthcheck, pre-deploy).

2. Cadastre as variáveis (aba **Variables**):

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | `postgresql://ponto_app:SENHA@HOST:PORT/railway` (**role restrito**) |
   | `DATABASE_URL_ADMIN` | `${{Postgres.DATABASE_URL}}` (admin — só as migrations usam) |
   | `APP_CRYPTO_KEY` | `openssl rand -base64 32` |
   | `JWT_ACCESS_SECRET` | `openssl rand -hex 32` |
   | `JWT_REFRESH_SECRET` | `openssl rand -hex 32` (diferente do de cima) |
   | `JWT_ACCESS_TTL` | `15m` |
   | `JWT_REFRESH_TTL` | `7d` |
   | `CORS_ORIGINS` | domínio do front (ver seção 3) |
   | `PLATAFORMA_INPI` | número do registro INPI do software |
   | `PLATAFORMA_DOC_DEV` | CNPJ da Tutts (só dígitos) |
   | `PLATAFORMA_TIPO_ID_DEV` | `1` (CNPJ) |
   | `PLATAFORMA_RAZAO` / `PLATAFORMA_NOME` / `PLATAFORMA_VERSAO` / `PLATAFORMA_EMAIL` | dados da plataforma |
   | `JOBS_LOOP` | `on` |

   `PORT` o Railway injeta sozinho.

   > O host do Postgres: use o **interno** (`postgres.railway.internal`) se a API estiver no mesmo
   > projeto — é mais rápido e não passa pela internet.

3. **Networking → Generate Domain** para expor a API (`https://algo.up.railway.app`).

4. Confira: `GET https://SUA-API.up.railway.app/health` → `{"status":"ok","ts":"..."}`

### Como o deploy funciona

- **Build:** Docker → `pnpm install` → `pnpm build:api` (tsc → `dist/`).
- **Pre-deploy:** `pnpm --filter @ponto/db migrate:prod` aplica as migrations com o `DATABASE_URL_ADMIN`.
- **Start:** `node dist/apps/api/src/main.js`.
- **Healthcheck:** `/health` (120s de timeout).

---

## 3. Front (Vercel)

1. **Add New → Project** → importe o mesmo repositório.
2. **Root Directory:** `apps/web`
   → marque **"Include files outside of the Root Directory"** (o build depende do workspace pnpm).
3. Framework: **Vite**. Build: `pnpm build`. Output: `dist`. (Já vem no `apps/web/vercel.json`.)
4. **Troque a URL da API** em [`apps/web/vercel.json`](apps/web/vercel.json):
   ```json
   { "source": "/api/:path*", "destination": "https://SUA-API.up.railway.app/:path*" }
   ```
5. Deploy.

### Por que um rewrite em vez de chamar a API direto

O front chama `/api/...` na **mesma origem**, e o Vercel repassa para o Railway.
Isso dispensa CORS e evita preflight. Nesse modo, `CORS_ORIGINS` na API é irrelevante
(mas deixe preenchido mesmo assim, para o caso de alguém bater direto na API).

**Alternativa** (chamar a API direto, sem rewrite):
- Vercel: variável `VITE_API_URL=https://SUA-API.up.railway.app`
- Railway: `CORS_ORIGINS=https://seu-front.vercel.app`

---

## 4. Primeiro acesso (bootstrap do MASTER)

Não existe usuário nenhum no banco recém-criado. Crie o MASTER (plataforma):

```bash
# no Railway: aba do serviço da API → "..." → Run a command
MASTER_EMAIL=voce@empresa.com.br MASTER_SENHA='uma-senha-forte' \
  pnpm --filter @ponto/api exec tsx scripts/criar-master.ts
```

Depois, logue no front com esse usuário e provisione o primeiro cliente (tenant).
O admin do cliente nasce com **troca de senha obrigatória** no primeiro login.

---

## 5. Checklist de produção

- [ ] `DATABASE_URL` usa o role **restrito** (`rolsuper=false`) — o teste da seção ⚠️
- [ ] `DATABASE_URL_ADMIN` só existe para as migrations
- [ ] Segredos gerados com `openssl` (nunca os do `.env.example`)
- [ ] `/health` respondendo 200
- [ ] Login funcionando (401 com senha errada, 200 com a certa)
- [ ] Certificado ICP-Brasil **real** (`.pfx`) cadastrado pelo cliente na tela de Certificado
- [ ] Domínio próprio no Vercel + `CORS_ORIGINS` atualizado

---

## Notas honestas

**A imagem Docker não pôde ser construída aqui** (o sandbox não tem Docker). O que **foi**
validado contra um PostgreSQL real, via TCP, igual ao Railway:

| Etapa | Resultado |
|---|---|
| `migrate:prod` num banco vazio | OK — 14 tabelas criadas |
| `setup-role.sql` | OK — `ponto_app` sem superusuário e sem bypassrls |
| `pnpm build:api` (tsc) | OK — compilou e reescreveu os aliases |
| Boot da API compilada + `GET /health` | OK — 200 |
| `POST /auth/login` com o role restrito | OK — 401 (DI e validação funcionando) |
| RLS: admin vs. role restrito | OK — provou o vazamento com admin |

O que resta ser exercitado no primeiro deploy real é o `docker build` em si (camadas, cache) e
o `preDeployCommand` do Railway.

**Escala do processador de jobs.** O `JOBS_LOOP` roda dentro da API. Com `numReplicas: 1`
(configurado) está tudo certo. Se você escalar para várias réplicas, todas vão processar a fila —
o *claim* otimista evita processar o mesmo job duas vezes, mas o certo é subir um **worker
dedicado** (mesma imagem, `JOBS_LOOP=on` só nele e `off` na API) ou migrar para
`SELECT ... FOR UPDATE SKIP LOCKED`.

**Tamanho da imagem.** O build acontece na mesma imagem que roda a app, então o `typescript`
e o fonte ficam junto. Funciona bem; se o tamanho incomodar, dá para migrar para um Dockerfile
multi-stage depois.
