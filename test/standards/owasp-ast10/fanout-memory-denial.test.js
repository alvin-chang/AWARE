'use strict';

const {
  describe,
  test,
  assert,
  loadMapper,
  sourceEvent,
  capturingMapper,
  assertAnnotationShape,
  assertDecisionShape
} = require('./helpers');

describe('AST10 cross-class fan-out — denied MEMORY.md write', () => {
  test('one denied sensitive write produces AST03 + AST09 sibling records', async () => {
    const source = sourceEvent({
      action: {
        type: 'tool_dispatch',
        toolId: 'write_file',
        target: '/profiles/architect/MEMORY.md',
        parameters: { path: '/profiles/architect/MEMORY.md' }
      },
      outcome: { success: false, errorMessage: 'AWARE_DENY: NOT_IN_ALLOW_LIST' }
    });
    const { mapper, decisions } = capturingMapper();
    const { classifyAndLog } = loadMapper();

    const annotations = await classifyAndLog(mapper, source);
    const classes = annotations.flatMap((item) => item.matchedClasses).sort();
    assert.deepEqual(classes, ['AST03', 'AST09']);
    assert.equal(decisions.length, 2);
    assert.equal(new Set(decisions.map((item) => item.decisionId)).size, 2);
    assert.deepEqual(new Set(decisions.map((item) => item.parentDecisionId)), new Set([source.decisionId]));

    const expectedRules = {
      AST03: 'over-privilege-write',
      AST09: 'denied-before-dispatch'
    };
    for (const annotation of annotations) {
      const astClass = annotation.matchedClasses[0];
      assertAnnotationShape(annotation, source, astClass, expectedRules[astClass]);
      const decision = decisions.find((item) => item.action.target === astClass);
      assertDecisionShape(decision, source, astClass, expectedRules[astClass]);
    }
  });
});
