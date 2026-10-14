-- Migration 0056: Enquete nos comunicados
--
-- O bloco ENQUETE fica no JSON do comunicado (pergunta, opções, regras).
-- comunicado_voto guarda o voto de cada pessoa: as opções escolhidas, quando
-- votou pela primeira vez, quando mudou por último e quantas vezes mudou.
-- Até a votação encerrar, a pessoa pode mudar o voto (fica só o último).

CREATE TABLE IF NOT EXISTS comunicado_voto (
  comunicado_id uuid NOT NULL REFERENCES comunicado(id) ON DELETE CASCADE,
  empregado_id uuid NOT NULL REFERENCES empregado(id),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  opcoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  votado_em timestamptz NOT NULL DEFAULT now(),
  alterado_em timestamptz NOT NULL DEFAULT now(),
  alteracoes integer NOT NULL DEFAULT 0,
  PRIMARY KEY (comunicado_id, empregado_id)
);
CREATE INDEX IF NOT EXISTS idx_comunicado_voto_tenant ON comunicado_voto (tenant_id, comunicado_id);

ALTER TABLE comunicado_voto ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'comunicado_voto_tenant') THEN
    CREATE POLICY comunicado_voto_tenant ON comunicado_voto
      USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
    EXECUTE 'GRANT ALL ON comunicado_voto TO ponto_app';
  END IF;
END $$;
