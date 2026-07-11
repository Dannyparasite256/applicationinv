import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { initEmailOnBoot } from './services/email.service';
import { logger } from './utils/logger';

async function bootstrap() {
  await connectDatabase();
  await connectRedis();
  initEmailOnBoot();

  const app = createApp();
  // Bind 0.0.0.0 so physical phones on the LAN (and Android emulator via 10.0.2.2) can reach the API
  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(env.PORT, host, () => {
    logger.info(`${env.APP_NAME} API listening on http://${host}:${env.PORT}`);
    logger.info(`API docs: ${env.API_URL}${env.API_PREFIX}/docs`);
    logger.info(`Environment: ${env.NODE_ENV}`);
    logger.info(`Email: ${env.EMAIL_ENABLED ? 'ENABLED' : 'disabled'}${env.SMTP_HOST ? ` via ${env.SMTP_HOST}` : ' (auto Ethereal if enabled)'}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await disconnectDatabase();
      await disconnectRedis();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
  });
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', { err });
  process.exit(1);
});
