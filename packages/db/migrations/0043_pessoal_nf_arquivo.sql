-- Migration 0043: arquivo da nota fiscal (MEI e motorista)
--
-- Um arquivo por lançamento (pessoa + competência + período). Cifrado em
-- repouso como os atestados (AES-256-GCM, CriptoService). Subir de novo
-- substitui o anterior.

CREATE TABLE IF NOT EXISTS pessoal_nf_arquivo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  pessoa_tipo varchar(10) NOT NULL,
  pessoa_id uuid NOT NULL,
  competencia varchar(7) NOT NULL,
  periodo varchar(10) NOT NULL DEFAULT 'MES',
  arquivo bytea NOT NULL,
  arquivo_nome varchar(160) NOT NULL,
  arquivo_mime varchar(80) NOT NULL,
  arquivo_bytes integer NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pessoal_nf_arquivo UNIQUE (tenant_id, pessoa_tipo, pessoa_id, competencia, periodo)
);
CREATE INDEX IF NOT EXISTS idx_pessoal_nf_arquivo_comp ON pessoal_nf_arquivo (tenant_id, competencia);

ALTER TABLE pessoal_nf_arquivo ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pessoal_nf_arquivo_tenant') THEN
    CREATE POLICY pessoal_nf_arquivo_tenant ON pessoal_nf_arquivo
      USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
    EXECUTE 'GRANT ALL ON pessoal_nf_arquivo TO ponto_app';
  END IF;
END $$;
