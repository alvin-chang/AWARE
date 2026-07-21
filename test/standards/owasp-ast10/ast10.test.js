'use strict';

const { describe, test, assert, sourceEvent, classifyEvent, assertAnnotationShape } = require('./helpers');

describe('AST10 — Resource & Cost Amplification', () => {
  test('skill_load emits cross-platform origin annotation', () => {
    const source = sourceEvent({ action: { type: 'skill_load', target: 'skill://portable', manifest: { content_hash: 'sha256:abc' } } });
    const annotation = classifyEvent(source).find((item) => item.matchedClasses.includes('AST10'));
    assert.ok(annotation);
    assertAnnotationShape(annotation, source, 'AST10', 'cross-platform-skill-load');
  });
});
