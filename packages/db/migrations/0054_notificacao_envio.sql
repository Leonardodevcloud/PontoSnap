-- Migration 0054: corrige o RLS das notificações + registro de envios
--
-- BUG (0035): as políticas de push_subscription e notificacao_preferencia
-- comparavam com current_setting('app.tenant_id'), mas o app grava o tenant em
-- 'app.current_tenant'. Com o papel do app (sem BYPASSRLS), salvar o aparelho
-- falhava e nenhuma inscrição era lida: nenhuma notificação saía.
-- Aqui as duas políticas são recriadas no padrão das outras tabelas.
--
-- notificacao_envio: uma linha por notificação (chave única por usuário), que
-- serve para (1) não mandar a mesma notificação duas vezes — o cron roda a cada
-- 2 minutos e pode haver mais de uma instância da API — e (2) o painel do RH
-- mostrar o que foi enviado e se chegou em algum aparelho.

CREATE TABLE IF NOT EXISTS notificacao_envio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  usuario_id uuid NOT NULL REFERENCES usuario(id),
  empregado_id uuid REFERENCES empregado(id),
  tipo varchar(30) NOT NULL,
  chave varchar(160) NOT NULL,
  titulo varchar(160) NOT NULL,
  dispositivos integer NOT NULL DEFAULT 0,
  entregues integer NOT NULL DEFAULT 0,
  erro varchar(200),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notificacao_envio UNIQUE (usuario_id, chave)
);
CREATE INDEX IF NOT EXISTS idx_notificacao_envio_tenant ON notificacao_envio (tenant_id, criado_em DESC);

ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS ultimo_sucesso_em timestamptz;
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS ultimo_erro varchar(200);
ALTER TABLE push_subscription ADD COLUMN IF NOT EXISTS ultimo_erro_em timestamptz;

ALTER TABLE notificacao_envio ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'notificacao_envio_tenant') THEN
    CREATE POLICY notificacao_envio_tenant ON notificacao_envio
      USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
    EXECUTE 'GRANT ALL ON notificacao_envio TO ponto_app';
  END IF;
END $$;

DROP POLICY IF EXISTS push_subscription_tenant ON push_subscription;
CREATE POLICY push_subscription_tenant ON push_subscription
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
DROP POLICY IF EXISTS notificacao_preferencia_tenant ON notificacao_preferencia;
CREATE POLICY notificacao_preferencia_tenant ON notificacao_preferencia
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
    EXECUTE 'GRANT ALL ON push_subscription TO ponto_app';
    EXECUTE 'GRANT ALL ON notificacao_preferencia TO ponto_app';
  END IF;
END $$;
