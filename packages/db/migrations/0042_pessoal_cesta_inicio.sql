-- Migration 0042: início da cesta básica por funcionário
--
-- A cesta só é paga a partir de um mês (carência após a admissão). Sem linha
-- aqui, o sistema usa 3 meses depois do início no ponto (data_inicio_ponto);
-- sem data de início, considera liberada.

CREATE TABLE IF NOT EXISTS pessoal_clt_cesta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  empregado_id uuid NOT NULL REFERENCES empregado(id),
  cesta_desde varchar(7) NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pessoal_clt_cesta UNIQUE (tenant_id, empregado_id)
);

ALTER TABLE pessoal_clt_cesta ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pessoal_clt_cesta_tenant') THEN
    CREATE POLICY pessoal_clt_cesta_tenant ON pessoal_clt_cesta
      USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
    EXECUTE 'GRANT ALL ON pessoal_clt_cesta TO ponto_app';
  END IF;
END $$;
