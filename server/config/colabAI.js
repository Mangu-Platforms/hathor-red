/**
 * Colab Enterprise AI Configuration
 *
 * This module configures the connection to Google Colab Enterprise APIs
 * for AI-powered music features including:
 * - Intelligent playlist generation
 * - Music recommendations
 * - Mood detection
 * - Natural language music search
 *
 * dose-1.69: timeout / maxRetries / rateLimit use shared toPositiveInt
 * (reject NaN/0/negative/junk; fall back to defaults) instead of raw parseInt.
 */

const { toPositiveInt } = require('../utils/streamToken');

const COLAB_CONFIG = {
  // API Configuration
  apiEndpoint: process.env.COLAB_API_ENDPOINT || 'https://colab.research.google.com/api/v1',
  projectId: process.env.COLAB_PROJECT_ID || '',
  region: process.env.COLAB_REGION || 'us-central1',

  // Authentication
  apiKey: process.env.COLAB_API_KEY || '',
  serviceAccountPath: process.env.COLAB_SERVICE_ACCOUNT_PATH || '',

  // Model Configuration
  models: {
    // Primary model for text generation and analysis
    textGeneration: process.env.COLAB_TEXT_MODEL || 'gemini-pro',
    // Embedding model for semantic search
    embedding: process.env.COLAB_EMBEDDING_MODEL || 'text-embedding-004',
    // Vision model for album art analysis
    vision: process.env.COLAB_VISION_MODEL || 'gemini-pro-vision'
  },

  // Request Configuration
  timeout: toPositiveInt(process.env.COLAB_TIMEOUT) ?? 30000,
  maxRetries: toPositiveInt(process.env.COLAB_MAX_RETRIES) ?? 3,

  // Rate Limiting
  rateLimit: {
    maxRequestsPerMinute: toPositiveInt(process.env.COLAB_RATE_LIMIT) ?? 60,
    maxTokensPerMinute: toPositiveInt(process.env.COLAB_TOKEN_LIMIT) ?? 100000
  },

  // Feature Flags
  features: {
    playlistGeneration: process.env.COLAB_FEATURE_PLAYLIST !== 'false',
    recommendations: process.env.COLAB_FEATURE_RECOMMENDATIONS !== 'false',
    moodDetection: process.env.COLAB_FEATURE_MOOD !== 'false',
    semanticSearch: process.env.COLAB_FEATURE_SEARCH !== 'false',
    chatAssistant: process.env.COLAB_FEATURE_CHAT !== 'false'
  }
};

/**
 * Validates the Colab configuration
 * @returns {Object} Validation result with isValid flag and any errors
 */
const validateConfig = () => {
  const errors = [];

  if (!COLAB_CONFIG.apiKey && !COLAB_CONFIG.serviceAccountPath) {
    errors.push('Either COLAB_API_KEY or COLAB_SERVICE_ACCOUNT_PATH must be set');
  }

  if (!COLAB_CONFIG.projectId) {
    errors.push('COLAB_PROJECT_ID is required');
  }

  return {
    isValid: errors.length === 0,
    errors,
    config: COLAB_CONFIG
  };
};

/**
 * Checks if the AI service is properly configured
 * @returns {boolean} True if configuration is valid
 */
const isConfigured = () => {
  return (COLAB_CONFIG.apiKey || COLAB_CONFIG.serviceAccountPath) && COLAB_CONFIG.projectId;
};

/**
 * Gets configuration for a specific feature
 * @param {string} feature - Feature name
 * @returns {Object} Feature configuration
 */
const getFeatureConfig = (feature) => {
  return {
    enabled: COLAB_CONFIG.features[feature] || false,
    model: COLAB_CONFIG.models.textGeneration,
    timeout: COLAB_CONFIG.timeout
  };
};

module.exports = {
  COLAB_CONFIG,
  validateConfig,
  isConfigured,
  getFeatureConfig
};
