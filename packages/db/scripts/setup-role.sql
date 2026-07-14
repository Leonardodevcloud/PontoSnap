-- =====================================================================
-- Role da aplicação (RODAR UMA VEZ, com o usuário admin do banco)
--
-- POR QUE ISSO É OBRIGATÓRIO:
-- O isolamento entre clientes depende de Row-Level Security. O PostgreSQL
-- NÃO aplica RLS a superusuários nem a roles com BYPASSRLS — eles enxergam
-- tudo, de todos os tenants, silenciosamente.
--
-- O usuário padrão do Railway/Neon costuma ser justamente o admin. Se a API
-- conectar com ele, a RLS vira decoração e um cliente vê os dados do outro.
--
-- Portanto: migrations rodam com o ADMIN. A API conecta com este role.
-- =====================================================================

-- 1) Troque a senha antes de rodar!
CREATE ROLE ponto_app LOGIN PASSWORD 'TROQUE_ESTA_SENHA'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;

-- 2) Acesso ao schema e às tabelas (sem DDL: a app não altera estrutura)
GRANT USAGE ON SCHEMA public TO ponto_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ponto_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ponto_app;

-- 3) Tabelas futuras (novas migrations) já nascem acessíveis
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ponto_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ponto_app;

-- Observação: o UPDATE/DELETE em ponto_marcacao continua bloqueado pela
-- trigger de imutabilidade — o GRANT acima não afrouxa isso.

-- 4) Conferência: deve retornar rolsuper=false e rolbypassrls=false
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'ponto_app';
