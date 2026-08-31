-- Migration 0035: Sistema de notificações push
-- Duas tabelas:
-- 1) push_subscription: armazena o endpoint/keys do navegador (por usuário, pode ter múltiplos dispositivos)
-- 2) notificacao_preferencia: quais tipos de notificação cada empregado quer receber

CREATE TABLE IF NOT EXISTS push_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  usuario_id uuid NOT NULL REFERENCES usuario(id),
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  -- user-agent pra identificar dispositivo (ex.: "Chrome 120 / Android")
  dispositivo varchar(200),
  criado_em timestamptz NOT NULL DEFAULT now(),
  -- Evita duplicar o mesmo endpoint pro mesmo usuário
  UNIQUE (usuario_id, endpoint)
);

CREATE TABLE IF NOT EXISTS notificacao_preferencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  empregado_id uuid NOT NULL REFERENCES empregado(id),
  -- Tipos de notificação
  lembrete_antes boolean NOT NULL DEFAULT true,
  lembrete_minutos integer NOT NULL DEFAULT 10,
  esqueceu_entrada boolean NOT NULL DEFAULT true,
  esqueceu_almoco boolean NOT NULL DEFAULT true,
  esqueceu_saida boolean NOT NULL DEFAULT true,
  ajuste_respondido boolean NOT NULL DEFAULT true,
  atestado_analisado boolean NOT NULL DEFAULT true,
  espelho_disponivel boolean NOT NULL DEFAULT true,
  resumo_semanal boolean NOT NULL DEFAULT false,
  banco_vencendo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empregado_id)
);

-- RLS: cada tenant só vê suas próprias subscriptions e preferências
ALTER TABLE push_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificacao_preferencia ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'push_subscription_tenant') THEN
    CREATE POLICY push_subscription_tenant ON push_subscription
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'notificacao_preferencia_tenant') THEN
    CREATE POLICY notificacao_preferencia_tenant ON notificacao_preferencia
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;
