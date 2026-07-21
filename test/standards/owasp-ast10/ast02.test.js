'use strict';

const { describe, test, assert, sourceEvent, classifyEvent, assertAnnotationShape } = require('./helpers');

describe('AST02 — Skill Tampering / Loader Injection', () => {
  test('unsigned publisher on skill_load emits supply-chain annotation', () => {
    const source = sourceEvent({
      actor: { publisherKey: undefined },
      action: { type: 'skill_load', target: 'skill://unsigned', manifest: { content_hash: 'sha256:abc' } }
    });
    const annotation = classifyEvent(source).find((item) => item.matchedClasses.includes('AST02'));
    assert.ok(annotation);
    assertAnnotationShape(annotation, source, 'AST02', 'supply-chain-unknown-publisher');
  });
});
