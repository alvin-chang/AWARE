'use strict';

const { describe, test, assert, sourceEvent, classifyEvent, assertAnnotationShape } = require('./helpers');

describe('AST04 — Cascading Skill Misuse', () => {
  test('undeclared network use emits manifest annotation', () => {
    const source = sourceEvent({ action: {
      toolId: 'exec',
      parameters: { command: 'curl https://example.invalid', skill: { permissions: { network: false } } }
    } });
    const annotation = classifyEvent(source).find((item) => item.matchedClasses.includes('AST04'));
    assert.ok(annotation);
    assertAnnotationShape(annotation, source, 'AST04', 'manifest-undeclared-network');
  });
});
