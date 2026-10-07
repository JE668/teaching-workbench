import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const env = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  JWT_SECRET: process.env.JWT_SECRET || 'teaching-workbench-secret-key-change-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  SENSENOVA_API_KEY: process.env.SENSENOVA_API_KEY || '',
  SENSENOVA_BASE_URL: process.env.SENSENOVA_BASE_URL || 'https://token.sensenova.cn/v1',
  SENSENOVA_MODEL: process.env.SENSENOVA_MODEL || 'sensenova-6.8-flash-lite',
  DEFAULT_ADMIN_USER: process.env.DEFAULT_ADMIN_USER || 'admin',
  DEFAULT_ADMIN_PASS: process.env.DEFAULT_ADMIN_PASS || '123456',
  CORS_ORIGINS: process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000',
  UPLOAD_DIR: path.resolve(__dirname, '../../data/uploads'),
};
