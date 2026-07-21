'use strict';

const { describe, test, assert, sourceEvent, classifyEvent, assertAnnotationShape } = require('./helpers');

describe('AST09 — Human-Agent Trust Exploitation', () => {
  test('AWARE denial receipt emits governance annotation', () => {
    const source = sourceEvent({ outcome: { success: false, errorMessage: 'AWARE_DENY: blocked by policy' } });
    const annotation = classifyEvent(source).find((item) => item.matchedClasses.includes('AST09'));
    assert.ok(annotation);
    assertAnnotationShape(annotation, source, 'AST09', 'denied-before-dispatch');
  });
});
