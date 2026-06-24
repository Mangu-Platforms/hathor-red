/**
 * Feature Flag Configuration
 * Hathor Red v2.0 - Gradual feature rollout
 */

export interface FeatureConfig {
  hlsStreaming: boolean;
  stemSeparation: boolean;
  vectorSearch: boolean;
  llmPlaylist: boolean;
  webRTCVideo: boolean;
  analytics: boolean;
  oauth: boolean;
  otel: boolean;
  rateLimiting: boolean;
  jobQueue: boolean;
}

const defaults: FeatureConfig = {
  hlsStreaming: true,
  stemSeparation: true,
  vectorSearch: true,
  llmPlaylist: true,
  webRTCVideo: true,
  analytics: true,
  oauth: true,
  otel: true,
  rateLimiting: true,
  jobQueue: true,
};

function getBoolEnv(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

export function loadFeatureFlags(): FeatureConfig {
  return {
    hlsStreaming: getBoolEnv('FEATURE_HLS_STREAMING', defaults.hlsStreaming),
    stemSeparation: getBoolEnv('FEATURE_STEM_SEPARATION', defaults.stemSeparation),
    vectorSearch: getBoolEnv('FEATURE_VECTOR_SEARCH', defaults.vectorSearch),
    llmPlaylist: getBoolEnv('FEATURE_LLM_PLAYLIST', defaults.llmPlaylist),
    webRTCVideo: getBoolEnv('FEATURE_WEBRTC_VIDEO', defaults.webRTCVideo),
    analytics: getBoolEnv('FEATURE_ANALYTICS', defaults.analytics),
    oauth: getBoolEnv('FEATURE_OAUTH', defaults.oauth),
    otel: getBoolEnv('FEATURE_OTEL', defaults.otel),
    rateLimiting: getBoolEnv('FEATURE_RATE_LIMITING', defaults.rateLimiting),
    jobQueue: getBoolEnv('FEATURE_JOB_QUEUE', defaults.jobQueue),
  };
}

export const features = loadFeatureFlags();

/**
 * Middleware to require a feature flag
 */
export function requireFeature(flagName: keyof FeatureConfig) {
  return (req: any, res: any, next: any) => {
    if (!features[flagName]) {
      return res.status(503).json({
        error: `Feature '${flagName}' is currently disabled`,
        code: 'FEATURE_DISABLED',
      });
    }
    next();
  };
}

export function isEnabled(flagName: keyof FeatureConfig): boolean {
  return features[flagName];
}

export function getFeatureStatus(): Record<keyof FeatureConfig, boolean> {
  return { ...features };
}