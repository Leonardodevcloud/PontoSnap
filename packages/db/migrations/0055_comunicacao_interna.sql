-- Migration 0055: Comunicação interna
--
-- comunicado: o aviso que o RH monta em blocos (texto, fotos, áudio, vídeo por
--   link, PDF). status: RASCUNHO | AGENDADO | PUBLICADO | ARQUIVADO.
-- comunicado_destinatario: quem recebeu (foto do público na hora da
--   publicação), quando abriu, quando assistiu/ouviu, quando deu ciência e a
--   reação. Serve de comprovante ("Li e estou ciente" com data e hora).
-- comunicado_midia: fotos, áudios e PDFs. Ficam no banco (fotos e áudios são
--   comprimidos no navegador antes de subir). Vídeo é sempre por link.

CREATE TABLE IF NOT EXISTS comunicado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  titulo varchar(160) NOT NULL,
  blocos jsonb NOT NULL DEFAULT '[]'::jsonb,
  publico jsonb NOT NULL DEFAULT '{"tipo":"TODOS","valores":[]}'::jsonb,
  pedir_ciencia boolean NOT NULL DEFAULT false,
  fixado boolean NOT NULL DEFAULT false,
  notificar boolean NOT NULL DEFAULT true,
  lembrar boolean NOT NULL DEFAULT true,
  reacoes boolean NOT NULL DEFAULT true,
  status varchar(10) NOT NULL DEFAULT 'RASCUNHO',
  agendado_para timestamptz,
  publicado_em timestamptz,
  lembrete_em timestamptz,
  notificados integer NOT NULL DEFAULT 0,
  autor_id uuid,
  autor_nome varchar(160),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comunicado_tenant ON comunicado (tenant_id, status, publicado_em DESC);

CREATE TABLE IF NOT EXISTS comunicado_destinatario (
  comunicado_id uuid NOT NULL REFERENCES comunicado(id) ON DELETE CASCADE,
  empregado_id uuid NOT NULL REFERENCES empregado(id),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  aberto_em timestamptz,
  midia_em timestamptz,
  ciente_em timestamptz,
  reacao varchar(8),
  PRIMARY KEY (comunicado_id, empregado_id)
);
CREATE INDEX IF NOT EXISTS idx_comunicado_dest_emp ON comunicado_destinatario (tenant_id, empregado_id);

CREATE TABLE IF NOT EXISTS comunicado_midia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  comunicado_id uuid REFERENCES comunicado(id) ON DELETE CASCADE,
  tipo varchar(10) NOT NULL,
  mime varchar(80) NOT NULL,
  nome varchar(160),
  bytes integer NOT NULL,
  dados bytea NOT NULL,
  miniatura bytea,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comunicado_midia_com ON comunicado_midia (comunicado_id);

ALTER TABLE comunicado ENABLE ROW LEVEL SECURITY;
ALTER TABLE comunicado_destinatario ENABLE ROW LEVEL SECURITY;
ALTER TABLE comunicado_midia ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comunicado', 'comunicado_destinatario', 'comunicado_midia'] LOOP
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
