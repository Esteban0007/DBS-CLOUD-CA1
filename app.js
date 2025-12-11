const express = require('express');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Security: Add security headers to protect against common vulnerabilities
// This sets headers like X-Content-Type-Options, X-Frame-Options, etc.
// Configure CSP to allow Bootstrap CDN for educational purposes
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://ipapi.co"],
      },
    },
  })
);

// Rate limiting: Prevent abuse by limiting requests per IP address
// Students learn about resource protection and API quota management
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware for static files
app.use(express.static(path.join(__dirname, 'public')));

// Function to fetch secrets from Google Secret Manager
async function getSecret(secretName) {
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: `projects/${process.env.GOOGLE_CLOUD_PROJECT}/secrets/${secretName}/versions/latest`,
  });
  return version.payload.data.toString();
}


let sequelize;
let Visit;
let server; 

// Main application logic
(async () => {
  try {
    // Fetch secrets and set environment variables
    if (process.env.NODE_ENV === 'production') {
      console.log('Fetching secrets for production...');
      process.env.DATABASE_URL = await getSecret('DATABASE_URL');
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is not set.');
      }
    }

    // Initialize Sequelize
    // Note: When using Cloud SQL Unix socket, SSL is not needed (proxy handles encryption)
    if (process.env.NODE_ENV === 'production') {
        // CORRECCIÓN CLAVE: Usar host y socketPath para Cloud SQL Unix
        // REEMPLAZA 'YOUR_DB_NAME', 'YOUR_USER', y 'YOUR_PASSWORD' con tus valores
        sequelize = new Sequelize('client_info', 'root', 'aU<.Mna#X0o?T+Sp', {
            dialect: 'postgres',
            host: `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`, 
            dialectOptions: {
                socketPath: `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`
            },
            logging: false
        });
    } else {
        // Desarrollo local: usa la URL normal
        sequelize = new Sequelize(process.env.DATABASE_URL, {
            dialect: 'postgres',
        });
    }

    // Define the Visit model
    Visit = sequelize.define('Visit', {
      ip: { type: DataTypes.STRING },
      user_agent: { type: DataTypes.TEXT },
      city: { type: DataTypes.STRING },
      region: { type: DataTypes.STRING },
      country: { type: DataTypes.STRING },
      latitude: { type: DataTypes.STRING },
      longitude: { type: DataTypes.STRING },
      visited_at: { type: DataTypes.DATE, defaultValue: Sequelize.NOW },
    });

    // Test database connection
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    // Sync models
    await Visit.sync();

    app.get('/', (_req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Health check endpoint for Google Cloud Platform monitoring
    // GCP uses this to verify the app is running correctly and database is connected
    app.get('/_health', async (_req, res) => {
      try {
        await sequelize.authenticate();
        res.status(200).json({
          status: 'ok',
          database: 'connected',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(503).json({
          status: 'error',
          database: 'disconnected',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Handle favicon requests to prevent 404 errors in browser console
    app.get('/favicon.ico', (_req, res) => {
      res.status(204).end(); // 204 No Content
    });

    // Route: Log client information
    // Apply rate limiting to prevent abuse
    app.get('/api/client-info', apiLimiter, async (req, res) => {
      let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown';
      const userAgent = req.headers['user-agent'] || 'Unknown';

      // Normalize localhost IPs
      if (ip === '::1' || ip === '127.0.0.1') {
        ip = 'localhost';
      }

      // Fetch geolocation data from ipapi.co (free tier: 1K/day, 30K/month)
      let locationData = {
        city: 'N/A',
        region: 'N/A',
        country: 'N/A',
        latitude: 'N/A',
        longitude: 'N/A',
      };

      if (ip !== 'localhost' && ip !== 'Unknown') {
        try {
          const response = await axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 3000 });
          locationData = {
            city: response.data.city || 'N/A',
            region: response.data.region || 'N/A',
            country: response.data.country_name || 'N/A',
            latitude: response.data.latitude || 'N/A',
            longitude: response.data.longitude || 'N/A',
          };
        } catch (error) {
          console.log('Geolocation API request failed:', error.message);
          // Keep default 'N/A' values if API fails
        }
      }

      // Store visit in database
      try {
        await Visit.create({
          ip,
          user_agent: userAgent,
          city: locationData.city,
          region: locationData.region,
          country: locationData.country,
          latitude: locationData.latitude.toString(),
          longitude: locationData.longitude.toString(),
        });
      } catch (error) {
        console.error('Database error:', error.message);
      }

      res.json({
        ip,
        userAgent,
        locationData,
      });
    });

    // Route: Fetch paginated logs
    // Apply rate limiting and input validation
    app.get('/api/logs', apiLimiter, async (req, res) => {
      const { page = 1, limit = 10 } = req.query;

      // Input validation: Ensure page and limit are positive integers
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      if (isNaN(pageNum) || pageNum < 1) {
        return res.status(400).json({ error: 'Invalid page number. Must be a positive integer.' });
      }

      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return res.status(400).json({ error: 'Invalid limit. Must be between 1 and 100.' });
      }

      const offset = (pageNum - 1) * limitNum;

      try {
        const { count, rows } = await Visit.findAndCountAll({
          offset: offset,
          limit: limitNum,
          order: [['visited_at', 'DESC']],
        });

        res.json({
          totalRecords: count,
          currentPage: pageNum,
          totalPages: Math.ceil(count / limitNum),
          logs: rows,
        });
      } catch (error) {
        console.error('Error fetching logs:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });


    // Route: Serve logs.html for /logs
    app.get('/logs', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'logs.html'));
    });

    
  } catch (error) {
    console.error('Failed to initialize application:', error.message);
  }
})();

// Start the server
server = app.listen(port, () => {
  console.log(`App running at http://localhost:${port}`);
});

// Graceful shutdown handler for cloud environments
// When GCP stops the instance, it sends SIGTERM signal
// This ensures database connections are closed properly before shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(async () => {
    console.log('HTTP server closed');
    try {
      if (sequelize) await sequelize.close(); 
      console.log('Database connection closed');
      process.exit(0);
    } catch (error) {
      console.error('Error closing database connection:', error.message);
      process.exit(1);
    }
  });
});