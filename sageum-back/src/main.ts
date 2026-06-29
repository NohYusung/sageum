import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origin = process.env.SAGEUM_FRONT_ORIGIN ?? 'http://localhost:3000';

  app.enableCors({
    origin,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.SAGEUM_BACK_PORT ?? process.env.PORT ?? 4000);
  await app.listen(port, '127.0.0.1');
}

void bootstrap();
