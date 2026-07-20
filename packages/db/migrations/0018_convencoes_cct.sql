-- Convenções coletivas (CCT/ACT) por empresa, aplicadas por funcionário.
-- Cada empresa cadastra as convenções que usa; cada funcionário aponta pra sua.
-- Campos vazios seguem a CLT. O prazo do banco de horas também vem daqui
-- (motorista pode ter 12 meses e administrativo 6, na mesma empresa).

CREATE TABLE IF NOT EXISTS ponto_cct (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  nome varchar(120) NOT NULL,
  uf varchar(2),
  vigencia varchar(60),
  -- Horas extras
  extra_dia_util_pct integer NOT NULL DEFAULT 50,
  extra_domingo_feriado_pct integer NOT NULL DEFAULT 100,
  extra_limite_diario_min integer NOT NULL DEFAULT 120,
  -- Tolerância
  tolerancia_diaria_min integer NOT NULL DEFAULT 10,
  tolerancia_por_marcacao_min integer NOT NULL DEFAULT 5,
  -- Adicional noturno
  noturno_adicional_pct integer NOT NULL DEFAULT 20,
  noturno_reduzida boolean NOT NULL DEFAULT true,
  noturno_inicio_min integer NOT NULL DEFAULT 1320, -- 22:00
  noturno_fim_min integer NOT NULL DEFAULT 300,     -- 05:00
  -- Jornada
  jornada_semanal_min integer NOT NULL DEFAULT 2640, -- 44h
  interjornada_minima_min integer NOT NULL DEFAULT 660, -- 11h
  intervalo_maior6h_min integer NOT NULL DEFAULT 60,
  -- Banco de horas (prazo do acordo, em meses). Nulo = usa a config da empresa.
  banco_prazo_meses integer,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_cct_tenant ON ponto_cct(tenant_id);

ALTER TABLE empregado ADD COLUMN IF NOT EXISTS cct_id uuid REFERENCES ponto_cct(id);

-- RLS: convenção é visível só dentro da empresa (mesmo padrão das demais tabelas).
ALTER TABLE ponto_cct ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant_ponto_cct ON ponto_cct;
CREATE POLICY isolamento_tenant_ponto_cct ON ponto_cct
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_master', true) = 'on'
  );
