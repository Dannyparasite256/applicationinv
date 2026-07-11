import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Enterprise IMS API',
      version: '1.0.0',
      description:
        'Production-ready multi-tenant Inventory Management, POS, Hospital, Pharmacy, Accounting REST API',
      contact: { name: 'Enterprise IMS Support' },
    },
    servers: [
      { url: `${env.API_URL}${env.API_PREFIX}`, description: 'API Server' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            code: { type: 'string' },
          },
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: {} },
            meta: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                totalPages: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Authentication & session management' },
      { name: 'Products', description: 'Inventory products' },
      { name: 'Sales', description: 'POS and sales' },
      { name: 'Purchases', description: 'Procurement' },
      { name: 'Customers', description: 'CRM customers' },
      { name: 'Hospital', description: 'Patients & clinical' },
      { name: 'Dashboard', description: 'Analytics KPIs' },
    ],
  },
  apis: ['./src/routes/*.ts', './dist/routes/*.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
