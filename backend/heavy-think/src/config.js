// src/config.js — K-by-task-type configuration

function freezeDeep(obj) {
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      freezeDeep(obj[key]);
    }
  }
  return Object.freeze(obj);
}

export const K_CONFIGS = freezeDeep({
  simple:    { min: 2, max: 2, default: 2, rationale: 'cost-sensitive' },
  standard:  { min: 3, max: 4, default: 4, rationale: 'balance quality vs cost' },
  security:  { min: 5, max: 8, default: 6, rationale: 'high stakes' },
  financial: { min: 5, max: 8, default: 6, rationale: 'high stakes' },
  creative:  { min: 2, max: 3, default: 3, rationale: 'diversity matters' },
});

export function defaultKForTaskType(task_type) {
  const cfg = K_CONFIGS[task_type];
  if (!cfg) {
    // unknown task_type → use standard
    return K_CONFIGS.standard.default;
  }
  return cfg.default;
}
