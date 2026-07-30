import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WebSocketServer } from 'ws';
import { AppModule } from './app.module';
import { RealtimeHub } from './realtime/realtime-hub';
import { HttpExceptionFilter } from './shared/http-exception.filter';
import { loadConfig } from './shared/config';
import { requestIdMiddleware } from './shared/request-id.middleware';

export async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule);
  app.use(requestIdMiddleware);
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  await app.init();
  const realtimeServer = new WebSocketServer({
    server: app.getHttpServer(),
    path: '/ws',
    maxPayload: 8 * 1024 * 1024,
  });
  app.get(RealtimeHub).attach(realtimeServer);
  await app.listen(config.PORT, config.HOST);
}

if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({
      level: 'error',
      message: 'Server failed to start',
      error: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  });
}

export * from './app.module';
export * from './resources/resource.service';
export * from './resources/resource.repository';
export * from './capabilities/search';
export * from './capabilities/router';
