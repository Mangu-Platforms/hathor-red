/**
 * API Documentation Routes
 * Hathor Red v2.0 - Swagger UI and OpenAPI spec
 */

import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';

const router = Router();
const openapiPath = path.join(__dirname, '..', 'docs', 'openapi.yaml');

let swaggerDoc: any;
try {
  swaggerDoc = YAML.load(openapiPath);
} catch (error) {
  console.warn('[Docs] Could not load OpenAPI spec:', error);
  swaggerDoc = { openapi: '3.0.0', info: { title: 'Hathor Red API', version: '2.0.0' } };
}

// Swagger UI
router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(swaggerDoc, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Hathor Red API Documentation',
}));

// Raw OpenAPI spec
router.get('/openapi.yaml', (req, res) => {
  res.setHeader('Content-Type', 'text/yaml');
  res.sendFile(openapiPath);
});

// ReDoc
router.get('/redoc', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Hathor Red API - ReDoc</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
        <style>body { margin: 0; padding: 0; }</style>
      </head>
      <body>
        <redoc spec-url="/api/docs/openapi.yaml"></redoc>
        <script src="https://cdn.jsdelivr.net/npm/redoc@2.0.0/bundles/redoc.standalone.js"></script>
      </body>
    </html>
  `);
});

export default router;
