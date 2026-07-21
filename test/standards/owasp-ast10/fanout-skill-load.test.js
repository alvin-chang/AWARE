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

describe('AST10 cross-class fan-out — skill_load', () => {
  test('one unsigned, unpinned skill_load produces AST02 + AST07 + AST10 sibling records', async () => {
    const source = sourceEvent({
      actor: { publisherKey: undefined },
      action: { type: 'skill_load', target: 'skill://fanout', manifest: { name: 'fanout' } }
    });
    const { mapper, decisions } = capturingMapper();
    const { classifyAndLog } = loadMapper();

    const annotations = await classifyAndLog(mapper, source);
    const classes = annotations.flatMap((item) => item.matchedClasses).sort();
    assert.deepEqual(classes, ['AST02', 'AST07', 'AST10']);
    assert.equal(decisions.length, 3);
    assert.equal(new Set(decisions.map((item) => item.decisionId)).size, 3);
    assert.deepEqual(new Set(decisions.map((item) => item.parentDecisionId)), new Set([source.decisionId]));

    const expectedRules = {
      AST02: 'supply-chain-unknown-publisher',
      AST07: 'update-without-pinning',
      AST10: 'cross-platform-skill-load'
    };
    for (const annotation of annotations) {
      const astClass = annotation.matchedClasses[0];
      assertAnnotationShape(annotation, source, astClass, expectedRules[astClass]);
      const decision = decisions.find((item) => item.action.target === astClass);
      assertDecisionShape(decision, source, astClass, expectedRules[astClass]);
    }
  });
});
