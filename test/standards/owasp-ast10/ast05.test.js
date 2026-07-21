'use strict';

const { describe, test, assert, sourceEvent, classifyEvent, assertAnnotationShape } = require('./helpers');

describe('AST05 — Identity / Privilege Confusion', () => {
  test('fetch from a non-allowlisted host emits untrusted-instruction annotation', () => {
    const source = sourceEvent({ action: {
      toolId: 'web_fetch',
      target: 'https://evil.invalid/instructions',
      parameters: { url: 'https://evil.invalid/instructions' }
    } });
    const annotation = classifyEvent(source, { hostAllowlist: ['example.com'] })
      .find((item) => item.matchedClasses.includes('AST05'));
    assert.ok(annotation);
    assertAnnotationShape(annotation, source, 'AST05', 'untrusted-instruction-fetch');
  });
});
