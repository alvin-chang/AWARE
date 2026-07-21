'use strict';

const { describe, test, assert, sourceEvent, classifyEvent, assertAnnotationShape } = require('./helpers');

describe('AST03 — Memory & Context Poisoning', () => {
  test('sensitive memory write emits over-privilege annotation', () => {
    const source = sourceEvent({ action: { target: '/profiles/architect/MEMORY.md' } });
    const annotation = classifyEvent(source).find((item) => item.matchedClasses.includes('AST03'));
    assert.ok(annotation);
    assertAnnotationShape(annotation, source, 'AST03', 'over-privilege-write');
  });
});
