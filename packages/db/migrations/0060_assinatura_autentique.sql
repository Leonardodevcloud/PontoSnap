-- Migration 0060: assinatura eletrônica de espelho de ponto e contracheque (Autentique)
--
-- integracao_autentique: uma por empresa (token da API cifrado pela app).
-- assinatura_documento: cada documento mandado (ou preparado) para assinatura —
--   espelho de ponto (gerado pelo sistema) ou contracheque (PDF da contabilidade),
--   por funcionário e mês. Guarda o arquivo enviado e o assinado (cifrados).
-- assinatura_upload: contracheques subidos em lote aguardando confirmação
--   (o RH confere a quem cada arquivo pertence antes de salvar).

CREATE TABLE IF NOT EXISTS integracao_autentique (
  tenant_id uuid PRIMARY KEY REFERENCES tenant(id),
  token text NOT NULL,
  conta_nome varchar(160),
  conta_email varchar(160),
  sandbox boolean NOT NULL DEFAULT true,
  mostrar_app boolean NOT NULL DEFAULT true,
  webhook_token varchar(48) NOT NULL UNIQUE,
  webhook_segredo text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assinatura_documento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  empregado_id uuid NOT NULL REFERENCES empregado(id),
  competencia varchar(7) NOT NULL,
  -- ESPELHO | CONTRACHEQUE
  tipo varchar(14) NOT NULL,
  -- RASCUNHO | ENVIADO | VISUALIZADO | ASSINADO | RECUSADO | CANCELADO | ERRO
  status varchar(12) NOT NULL DEFAULT 'RASCUNHO',
  arquivo bytea NOT NULL,
  arquivo_nome varchar(160) NOT NULL,
  arquivo_bytes integer NOT NULL,
  hash_sha256 varchar(64) NOT NULL,
  autentique_id varchar(80),
  assinatura_public_id varchar(80),
  -- EMAIL | WHATSAPP | APP
  canal varchar(10),
  sandbox boolean NOT NULL DEFAULT false,
  lembrete varchar(8),
  prazo date,
  enviado_em timestamptz,
  enviado_por varchar(160),
  visualizado_em timestamptz,
  assinado_em timestamptz,
  recusado_em timestamptz,
  motivo_recusa text,
  erro text,
  arquivo_assinado bytea,
  sincronizado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_assinatura_documento UNIQUE (tenant_id, empregado_id, competencia, tipo)
);
CREATE INDEX IF NOT EXISTS idx_assinatura_documento_comp ON assinatura_documento (tenant_id, competencia);
CREATE INDEX IF NOT EXISTS idx_assinatura_documento_autentique ON assinatura_documento (autentique_id);

CREATE TABLE IF NOT EXISTS assinatura_upload (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  competencia varchar(7) NOT NULL,
  arquivo bytea NOT NULL,
  arquivo_nome varchar(160) NOT NULL,
  arquivo_bytes integer NOT NULL,
  sugestao_empregado_id uuid,
  -- CPF | NOME | CPF_PDF | NOME_PDF
  como varchar(10),
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE integracao_autentique ENABLE ROW LEVEL SECURITY;
ALTER TABLE assinatura_documento ENABLE ROW LEVEL SECURITY;
ALTER TABLE assinatura_upload ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integracao_autentique', 'assinatura_documento', 'assinatura_upload'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = t || '_tenant') THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid OR current_setting(''app.is_master'', true) = ''on'') '
        'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid OR current_setting(''app.is_master'', true) = ''on'')',
        t || '_tenant', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
      EXECUTE format('GRANT ALL ON %I TO ponto_app', t);
    END IF;
  END LOOP;
END $$;
