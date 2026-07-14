import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Em produção, restrinja aos domínios do front (ex.: https://app.pontosnap.com.br).
  // Sem CORS_ORIGINS, libera geral — ok em dev, ruim em produção.
  const origins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: origins?.length ? origins : true });

  const porta = Number(process.env.PORT ?? 3000);
  await app.listen(porta, '0.0.0.0');
  console.log(`PontoSnap API ouvindo na porta ${porta}`);
}
void bootstrap();
