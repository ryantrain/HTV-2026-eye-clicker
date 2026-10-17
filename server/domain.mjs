export const intents = ['RESTROOM', 'COMFORT', 'WATER', 'ASSISTANCE'];
export function validateOrder(value) {
  if (
    !value ||
    !intents.includes(value.intent) ||
    typeof value.requestId !== 'string' ||
    !/^[\w-]{8,80}$/.test(value.requestId)
  )
    throw new Error('Invalid request');
  return { intent: value.intent, requestId: value.requestId };
}
export function validateSamples(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 120)
    throw new Error('Expected 1–120 samples');
  return value.map((s) => {
    if (
      !s ||
      !['x', 'y', 'jitter', 'blinkMs'].every(
        (k) => typeof s[k] === 'number' && Number.isFinite(s[k]),
      ) ||
      s.x < 0 ||
      s.x > 1 ||
      s.y < 0 ||
      s.y > 1 ||
      s.jitter < 0 ||
      s.jitter > 10 ||
      s.blinkMs < 0 ||
      s.blinkMs > 2000
    )
      throw new Error('Invalid telemetry');
    return { x: s.x, y: s.y, jitter: s.jitter, blinkMs: s.blinkMs };
  });
}
export function fallbackOrder(intent, hour) {
  const values = {
    RESTROOM: ['Care team', 'Help requested with using the restroom.'],
    COMFORT: [
      'Facilities',
      hour >= 19 || hour < 7
        ? 'Please check room comfort and offer extra bedding.'
        : 'Please check seating, bedding and room comfort.',
    ],
    WATER: [
      'Care team',
      'Water requested. Check the care plan before providing drinks.',
    ],
    ASSISTANCE: [
      'Care team',
      'General assistance requested. Please check in with the patient.',
    ],
  };
  const [department, summary] = values[intent];
  return { department, summary };
}
export function validateRouting(value) {
  if (
    !value ||
    !['Care team', 'Facilities'].includes(value.department) ||
    typeof value.summary !== 'string' ||
    !value.summary.trim() ||
    value.summary.length > 500
  )
    throw new Error('Invalid AI routing response');
  return { department: value.department, summary: value.summary };
}
