-- Modelos de nota fiscal do prestador: tomador completo, código do serviço e a
-- descrição com campos automáticos ({mes}, {dias}…), configurados uma vez por
-- operação. Cada prestador usa o seu modelo (ou o padrão do tipo dele).
CREATE TABLE IF NOT EXISTS pessoal_modelo_nota (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  nome varchar(80) NOT NULL,
  -- MEI | MOTORISTA: padrão de quem é deste tipo e não tem modelo escolhido.
  padrao_tipo varchar(10),
  tomador_cnpj varchar(14) NOT NULL,
  tomador_razao varchar(160) NOT NULL,
  tomador_endereco varchar(300),
  tomador_telefone varchar(30),
  tomador_email varchar(160),
  codigo_servico varchar(12),
  codigo_descricao varchar(200),
  descricao text NOT NULL,
  observacao varchar(400),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_modelo_nota_tenant ON pessoal_modelo_nota (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_modelo_nota_padrao ON pessoal_modelo_nota (tenant_id, padrao_tipo) WHERE padrao_tipo IS NOT NULL;

ALTER TABLE pessoal_prestador ADD COLUMN IF NOT EXISTS modelo_nota_id uuid REFERENCES pessoal_modelo_nota(id) ON DELETE SET NULL;
-- Motorista: quais dias da semana trabalhou (para {dias} na descrição).
ALTER TABLE pessoal_lancamento ADD COLUMN IF NOT EXISTS dias_datas jsonb;
-- O que foi pedido na nota, congelado ao liberar o valor (conferência compara com isto).
ALTER TABLE pessoal_nota ADD COLUMN IF NOT EXISTS instrucoes jsonb;

ALTER TABLE pessoal_modelo_nota ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pessoal_modelo_nota_tenant') THEN
    CREATE POLICY pessoal_modelo_nota_tenant ON pessoal_modelo_nota
      USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on')
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid OR current_setting('app.is_master', true) = 'on');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app') THEN
    GRANT ALL ON pessoal_modelo_nota TO ponto_app;
  END IF;
END $$;
