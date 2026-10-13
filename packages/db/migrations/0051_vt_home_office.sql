-- Dias da semana em home office (sem vale-transporte), por funcionário e com vigência.
-- Lista de dias separados por vírgula (0=dom … 6=sáb). Vazio = todos presenciais.
ALTER TABLE "pessoal_clt_config" ADD COLUMN IF NOT EXISTS "vt_sem_dias" varchar(20) NOT NULL DEFAULT '';
