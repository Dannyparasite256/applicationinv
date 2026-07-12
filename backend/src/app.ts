import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { swaggerSpec } from './config/swagger';
import routes from './routes';
import { requestId } from './middleware/requestId';
import { globalRateLimiter } from './middleware/rateLimiter';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // Dev/mobile: never force HTTPS upgrade — Capacitor uses cleartext HTTP
      // to the PC LAN / USB reverse tunnel.
      contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
      strictTransportSecurity: env.NODE_ENV === 'production' ? undefined : false,
    })
  );
  const corsOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  // Capacitor Android/iOS WebViews use these origins
  const nativeOrigins = [
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost',
    'https://localhost',
    'http://localhost:5173',
    'https://localhost:5173',
    'http://10.0.2.2:5173',
    'http://10.0.2.2:4000',
  ];
  const isAllowedOrigin = (origin: string) => {
    if (corsOrigins.includes('*') || corsOrigins.includes(origin) || nativeOrigins.includes(origin)) {
      return true;
    }
    // Hosted frontends on Render (and similar) — always allow HTTPS onrender.com
    if (/^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(origin)) {
      return true;
    }
    // Private LAN IPs used by phones / tablets talking to a dev PC
    return /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|127\.0\.0\.1|localhost)(:\d+)?$/.test(
      origin
    );
  };
  app.use(
    cors({
      // Must return the origin string (not bare `true`) so Access-Control-Allow-Origin is set
      // when credentials: true — otherwise Android WebView login fails with "Network Error".
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (isAllowedOrigin(origin)) {
          callback(null, origin);
          return;
        }
        callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Company-Id', 'X-Request-Id', 'X-Device-Id'],
    })
  );
  app.use(compression());
  // Product/logo photos are stored as data URLs in JSON bodies (durable multi-device sync)
  app.use(express.json({ limit: '12mb' }));
  app.use(express.urlencoded({ extended: true, limit: '12mb' }));
  app.use(cookieParser());
  app.use(globalRateLimiter);

  app.use('/uploads', express.static(path.resolve(process.cwd(), env.UPLOAD_DIR)));

  app.use(
    `${env.API_PREFIX}/docs`,
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'Enterprise IMS API Docs',
      swaggerOptions: { persistAuthorization: true },
    })
  );
  app.get(`${env.API_PREFIX}/docs.json`, (_req, res) => res.json(swaggerSpec));

  app.use(env.API_PREFIX, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
