# Arquitetura — Sistema de Ponto Eletrônico (REP-P) · SaaS Multi-Tenant

> Documento de referência da fundação do projeto. Registra as decisões
> estruturais, o modelo de negócio e o mapa de conformidade legal.
> Base regulatória: **Portaria MTP nº 671/2021** (REP-P).

---

## 1. Visão geral

Plataforma **SaaS multi-tenant** de registro eletrônico de ponto, classificada
como **REP-P (Registrador Eletrônico de Ponto via Programa)**. Vendida para
múltiplas empresas (clientes), cada uma com seus próprios empregados, marcações
e arquivos fiscais, com isolamento de dados entre clientes.

O app do colaborador é **mobile-first (PWA)**; o painel de gestão (RH) e a conta
master vivem no mesmo aplicativo web, diferenciados por perfil/permissão.

---

## 2. Modelo de contas (hierarquia)

```
MASTER (plataforma / você)
  │  detém: registro INPI do software, CNPJ do desenvolvedor
  │  cria e gerencia →
  └── CLIENTE (tenant = empregador)
        │  detém: CNPJ próprio, REP-P próprio, arquivos fiscais próprios
        │  cria e gerencia →
        └── FUNCIONÁRIO (colaborador)
              detém: suas marcações e comprovantes
```

### Perfis (RBAC)

| Perfil          | Escopo      | Pode                                                        |
|-----------------|-------------|------------------------------------------------------------|
| `MASTER`        | Plataforma  | Criar/gerenciar clientes, ver saúde do sistema, faturamento |
| `ADMIN_CLIENTE` | 1 tenant    | Gerenciar funcionários, tratar marcações, gerar AFD/AEJ/Espelho |
| `RH`            | 1 tenant    | Tratamento de ponto, relatórios (sem gestão de conta)      |
| `COLABORADOR`   | Ele mesmo   | Bater ponto, ver/baixar seus comprovantes (últimas 48h+)   |

---

## 3. Multi-tenancy

**Estratégia:** banco de dados compartilhado + coluna `tenant_id` em todas as
tabelas de negócio + **Row-Level Security (RLS)** do PostgreSQL.

- Cada requisição autenticada define o `tenant_id` no contexto da conexão;
  as policies de RLS garantem que nenhuma query cruze a fronteira do cliente.
- Um `tenant` corresponde a **um empregador** e, portanto, a **um REP-P**
  (`ponto_rep`). AFD/AEJ são sempre gerados por tenant.
- **Alternativa futura:** clientes que exijam isolamento físico podem ser
  migrados para schema dedicado sem refatorar o núcleo.

> Nota de conformidade: o registro **INPI é do software** (único, da plataforma).
> No cabeçalho do AFD, o nº INPI (campo 7) e o CNPJ do desenvolvedor (campo 13)
> são constantes; o CNPJ do empregador (campo 4) varia por tenant.

---

## 4. Stack

| Camada        | Escolha                          | Motivo                                        |
|---------------|----------------------------------|-----------------------------------------------|
| Monorepo      | pnpm workspaces + Turborepo      | Build cacheado, pacotes compartilhados        |
| Backend       | NestJS + TypeScript              | Modular, injeção de dependência, guards RBAC  |
| Banco         | PostgreSQL + Drizzle ORM         | TS-first; convive com triggers e append-only  |
| Autenticação  | JWT (access + refresh) + RBAC    | Perfis MASTER / ADMIN_CLIENTE / RH / COLAB    |
| Frontend      | React + Vite + vite-plugin-pwa   | PWA mobile-first; rotas por perfil            |
| Testes        | Vitest                           | `rep-core` validado contra exemplos do MTE    |
| Infra local   | docker-compose                   | Paridade com produção                         |

---

## 5. Estrutura do monorepo

```
ponto-eletronico/
├── apps/
│   ├── api/                    # NestJS
│   │   └── src/modules/
│   │       ├── auth/           # login, JWT, refresh, RBAC
│   │       ├── tenant/         # clientes (CRUD pelo MASTER)
│   │       ├── empregado/      # funcionários (CRUD pelo cliente)
│   │       ├── marcacao/       # bater ponto (usa rep-core)
│   │       ├── tratamento/     # abonos, ausências, banco de horas
│   │       └── fiscal/         # gerar/baixar AFD, AEJ, Espelho, comprovante
│   └── web/                    # React PWA (um app, telas por perfil)
│       ├── colaborador/        #   bater ponto, meus comprovantes
│       ├── rh/                 #   funcionários, tratamento, arquivos
│       └── master/             #   clientes, faturamento, saúde
├── packages/
│   ├── rep-core/               # ⭐ MOTOR DE CONFORMIDADE (puro, sem HTTP/DB)
│   │   ├── hash-chain/         #   cadeia SHA-256 (imutabilidade)
│   │   ├── afd/                #   gerador AFD posicional + CRC-16/KERMIT
│   │   ├── aej/                #   gerador AEJ (pipe)
│   │   ├── comprovante/        #   PDF do comprovante
│   │   ├── espelho/            #   espelho de ponto
│   │   └── assinatura/         #   ICP-Brasil: PAdES (PDF) e CAdES (.p7s)
│   ├── db/                     # schema Drizzle, migrations, triggers, seeds
│   └── shared/                 # tipos/enums (TipoRegistro, Coletor, Perfil, DTOs)
├── docker-compose.yml
├── turbo.json
└── package.json
```

### Princípio central: `rep-core` é isolado

Todo o código legalmente crítico vive em `rep-core` como **funções puras**
(marcação entra → arquivo fiscal sai), sem dependência de HTTP, banco ou
framework. Isso permite testá-lo exaustivamente e de forma independente contra
os validadores oficiais do MTE. É o coração que responde numa fiscalização.

---

## 6. Modelo de dados (essencial, tenant-scoped)

- `tenant` — cliente/empregador (CNPJ, razão social, local de prestação).
- `ponto_rep` — config do REP-P por tenant (nº INPI, CNPJ empregador/desenv.,
  ponteiro da cadeia: `ultimo_nsr`, `ultimo_hash`).
- `usuario` — contas com perfil e `tenant_id`.
- `empregado` — funcionários do tenant (CPF, nome, horário contratual).
- `ponto_marcacao` — **append-only, imutável** (trigger bloqueia UPDATE/DELETE);
  cadeia de hash SHA-256 (registro tipo 7 do AFD).
- `ponto_evento` — eventos sensíveis (tipo 6: disponibilidade/indisponibilidade).
- `ponto_horario_contratual` — jornada e pares entrada/saída (tipo 04 do AEJ).
- `ponto_tratamento` — marcações tratadas por cima das originais (tipo 05).
- `ponto_ausencia` — ausências e banco de horas (tipo 07).

Todas as tabelas de negócio carregam `tenant_id` e são protegidas por RLS.

---

## 7. Conformidade legal (mapa)

| Exigência (Portaria 671)            | Onde é resolvido                              |
|-------------------------------------|-----------------------------------------------|
| Registro INPI do software           | Config da plataforma (nº no cabeçalho do AFD) |
| Imutabilidade das marcações         | Trigger append-only + cadeia de hash SHA-256  |
| AFD (Arquivo-Fonte de Dados)        | `rep-core/afd` — posicional, CRC-16/KERMIT    |
| AEJ (Arquivo Eletrônico de Jornada) | `rep-core/aej` — delimitado por pipe          |
| Espelho de Ponto                    | `rep-core/espelho`                            |
| Comprovante do trabalhador (PDF)    | `rep-core/comprovante` + assinatura PAdES     |
| Assinatura AFD/AEJ                  | `rep-core/assinatura` — CAdES `.p7s` destacado |
| Certificado ICP-Brasil              | Fornecido por tenant (empregador)             |
| Disponibilizar à fiscalização (2d)  | Módulo `fiscal` — exportação sob demanda      |
| LGPD (biometria/geolocalização)     | Base legal, minimização, retenção; ver §8     |
| Atestado Técnico e Termo de Resp.   | Documento assinado pela plataforma (jurídico) |

**Padrões de assinatura (não confundir):**
- Comprovante PDF → **PAdES**.
- AFD e AEJ → **CAdES**, em arquivo `.p7s` destacado, nomeado `arquivo.txt.p7s`.

---

## 8. Segurança e LGPD

- RLS no banco como última linha de isolamento entre tenants.
- Geolocalização/biometria (se usadas) são **dados pessoais**: exigem base
  legal, finalidade documentada, minimização e política de retenção.
- Metadados de auditoria (IP, geo) ficam **fora** do cálculo do hash do AFD.
- Segredos (JWT, certificados, credenciais) fora do código, em variáveis de
  ambiente / secret manager.
- Retenção mínima recomendada dos dados de ponto: **5 anos**.

---

## 9. Status e roadmap

**Núcleo já prototipado e testado** (a migrar para `rep-core`):
- ✅ Cadeia de hash SHA-256 (gravação serializada + verificação de integridade)
- ✅ Gerador AFD (larguras conferidas, CRC-16/KERMIT validado)
- ✅ Gerador AEJ (estrutura conferida)
- ✅ Comprovante PDF

**A fazer:**
- [ ] Esqueleto do monorepo (pnpm + Turborepo + NestJS + Vite PWA)
- [ ] `packages/db` — schema Drizzle + RLS + triggers
- [ ] Multi-tenancy (contexto de tenant + policies RLS)
- [ ] Auth + RBAC (MASTER / ADMIN_CLIENTE / RH / COLABORADOR)
- [ ] Assinatura real ICP-Brasil (PAdES + CAdES) com certificado do tenant
- [ ] Espelho de Ponto
- [ ] Motor de apuração (pares E/S, extras, DSR, banco de horas)
- [ ] Validação de AFD/AEJ nos validadores oficiais do MTE
- [ ] Atestado Técnico e Termo de Responsabilidade (revisão jurídica)

---

## 10. Decisões registradas

| Decisão                    | Escolha                        |
|----------------------------|--------------------------------|
| Tipo de sistema            | REP-P (software)               |
| Público-alvo do ponto      | Funcionários CLT               |
| Modelo comercial           | SaaS multi-tenant              |
| Isolamento entre clientes  | Banco compartilhado + RLS      |
| App colaborador + RH       | App único, perfis/permissões   |
| Repositório                | Monorepo                       |
| Backend                    | NestJS + TypeScript            |
| Frontend                   | React + Vite + PWA             |
| Banco                      | PostgreSQL + Drizzle           |
```
