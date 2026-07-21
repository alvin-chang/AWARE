'use strict';

const { describe, test, assert, sourceEvent, classifyEvent, assertAnnotationShape } = require('./helpers');

describe('AST07 — Goal / Instruction Hijack', () => {
  test('unpinned skill_load emits update-without-pinning annotation', () => {
    const source = sourceEvent({ action: { type: 'skill_load', target: 'skill://unpinned', manifest: { name: 'demo' } } });
    const annotation = classifyEvent(source).find((item) => item.matchedClasses.includes('AST07'));
    assert.ok(annotation);
    assertAnnotationShape(annotation, source, 'AST07', 'update-without-pinning');
  });
});
