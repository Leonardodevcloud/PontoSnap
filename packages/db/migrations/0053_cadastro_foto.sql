-- Migration 0053: atualização cadastral com foto
--
-- Foto do funcionário fica numa tabela própria (bytes pesados longe dos
-- SELECT * de empregado). Cifrada em repouso como os atestados. Guarda a foto
-- (320px) e a miniatura (96px) que vai nas listas.
-- Contatos e semente da caricatura ficam em empregado/prestador.

ALTER TABLE "empregado" ADD COLUMN IF NOT EXISTS "celular" varchar(20);
ALTER TABLE "empregado" ADD COLUMN IF NOT EXISTS "email_pessoal" varchar(160);
ALTER TABLE "empregado" ADD COLUMN IF NOT EXISTS "contato_emergencia" varchar(160);
ALTER TABLE "empregado" ADD COLUMN IF NOT EXISTS "cadastro_atualizado_em" timestamptz;
ALTER TABLE "empregado" ADD COLUMN IF NOT EXISTS "avatar_semente" integer;
ALTER TABLE "pessoal_prestador" ADD COLUMN IF NOT EXISTS "avatar_semente" integer;

CREATE TABLE IF NOT EXISTS empregado_foto (
  empregado_id uuid PRIMARY KEY REFERENCES empregado(id),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  foto bytea NOT NULL,
  miniatura bytea NOT NULL,
  -- REVISAR (vale, RH ainda não olhou) | APROVADA | RECUSADA
  status varchar(10) NOT NULL DEFAULT 'REVISAR',
  motivo varchar(200),
  origem varchar(10) NOT NULL DEFAULT 'CAMERA',
  enviada_em timestamptz NOT NULL DEFAULT now(),
  revisada_em timestamptz,
  revisada_por varchar(160)
);
CREATE INDEX IF NOT EXISTS idx_empregado_foto_tenant ON empregado_foto (tenant_id, status);

ALTER TABLE empregado_foto ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'empregado_foto_tenant') THEN
    CREATE POLICY empregado_foto_tenant ON empregado_foto
      USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
    EXECUTE 'GRANT ALL ON empregado_foto TO ponto_app';
  END IF;
END $$;
