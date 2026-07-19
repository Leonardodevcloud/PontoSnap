import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // A foto do atestado vai como base64 no corpo JSON, e o padrão do Express é
  // só 100 KB — estourava com "request entity too large". 10 MB cobre os 5 MB
  // do arquivo + o inchaço do base64; o service ainda barra acima de 5 MB reais.
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Em produção, restrinja aos domínios do front (ex.: https://app.pontosnap.online).
  // Sem CORS_ORIGINS, libera geral — ok em dev, ruim em produção.
  const origins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: origins?.length ? origins : true });

  const porta = Number(process.env.PORT ?? 3000);
  await app.listen(porta, '0.0.0.0');
  console.log(`PontoSnap API ouvindo na porta ${porta}`);
}
void bootstrap();
