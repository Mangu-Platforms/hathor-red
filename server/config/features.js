/**
 * Feature flags for Project Olympus pillars.
 *
 * Each flag gates route mounting (and worker handler registration where noted)
 * in server/index.js, so a pillar can be disabled via environment without a
 * code change. Flags default ON; set FEATURE_X=false to disable.
 */

function flag(name, defaultValue = true) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return !['false', '0', 'off', 'no'].includes(String(raw).toLowerCase());
}

module.exports = {
  flag,
  isMediaPipelineEnabled: () => flag('FEATURE_MEDIA_PIPELINE'),
  isCommerceEnabled: () => flag('FEATURE_COMMERCE'),
  isDiscoveryEnabled: () => flag('FEATURE_DISCOVERY'),
  isSocialEnabled: () => flag('FEATURE_SOCIAL'),
  isIntelEnabled: () => flag('FEATURE_INTEL'),
  isPrivacyEnabled: () => flag('FEATURE_PRIVACY'),
  isWorkerEnabled: () => flag('FEATURE_WORKER'),
};
