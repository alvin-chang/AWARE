/**
 * t0/crypto-id.ts — T0-3: Cryptographic identity
 *
 * Every agent action must be signed with the agent's private key.
 * Invalid or missing signature → BLOCK. No override possible.
 */

import { createSign, createVerify, generateKeyPairSync, Sign } from 'crypto';
import type { AgentAction, Constraint, ConstraintResult, CryptoKeyPair } from '../types.js';

export class CryptoIdConstraint implements Constraint {
  readonly id = 'T0-3';
  readonly tier: 'T0' = 'T0';
  readonly name = 'Cryptographic Identity';
  readonly description = 'All agent actions must be signed with agent private key';

  // agentId → keypair
  private keyPairs = new Map<string, CryptoKeyPair>();

  /**
   * Generate a new key pair for an agent.
   */
  generateKeyPair(agentId: string): CryptoKeyPair {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const keyPair: CryptoKeyPair = {
      publicKey,
      privateKey,
      keyId: `${agentId}-${Date.now()}`,
    };

    this.keyPairs.set(agentId, keyPair);
    return keyPair;
  }

  /**
   * Register a key pair for an agent (e.g., loaded from secure storage).
   */
  registerKeyPair(agentId: string, keyPair: CryptoKeyPair): void {
    this.keyPairs.set(agentId, keyPair);
  }

  /**
   * Get the public key for an agent (used for verification by others).
   */
  getPublicKey(agentId: string): string | undefined {
    return this.keyPairs.get(agentId)?.publicKey;
  }

  /**
   * Get the key ID for an agent.
   */
  getKeyId(agentId: string): string | undefined {
    return this.keyPairs.get(agentId)?.keyId;
  }

  /**
   * Sign an action payload (used by agent or test).
   */
  sign(agentId: string, payload: string): string | undefined {
    const keyPair = this.keyPairs.get(agentId);
    if (!keyPair) return undefined;

    try {
      const sign: Sign = createSign('RSA-SHA256');
      sign.update(payload);
      sign.end();
      return sign.sign(keyPair.privateKey, 'base64');
    } catch {
      return undefined;
    }
  }

  /**
   * Verify a signature against a payload and public key.
   */
  verify(publicKey: string, payload: string, signature: string): boolean {
    try {
      const verify = createVerify('RSA-SHA256');
      verify.update(payload);
      verify.end();
      return verify.verify(publicKey, signature, 'base64');
    } catch {
      return false;
    }
  }

  /**
   * Build the canonical signing payload from an action.
   */
  buildSigningPayload(action: AgentAction): string {
    // Canonical representation: actionId|agentId|action|timestamp|paramsJson
    const paramsJson = JSON.stringify(action.params ?? {});
    return [
      action.id,
      action.agentId,
      action.action,
      action.timestamp,
      paramsJson,
    ].join('|');
  }

  async evaluate(action: AgentAction): Promise<ConstraintResult> {
    const signature = action.metadata?.signature as string | undefined;

    // T0-3: Missing signature is always a block
    if (!signature) {
      return {
        allowed: false,
        violated: {
          tier: 'T0',
          constraint: 'T0-3',
          message: `T0-3 BLOCKED: Action "${action.action}" (id=${action.id}) has no cryptographic signature. All agent actions must be signed.`,
          blockedAt: new Date().toISOString(),
          action,
        },
      };
    }

    const keyPair = this.keyPairs.get(action.agentId);
    if (!keyPair) {
      return {
        allowed: false,
        violated: {
          tier: 'T0',
          constraint: 'T0-3',
          message: `T0-3 BLOCKED: No cryptographic key pair registered for agent "${action.agentId}". Cannot verify signature.`,
          blockedAt: new Date().toISOString(),
          action,
        },
      };
    }

    const payload = this.buildSigningPayload(action);
    const isValid = this.verify(keyPair.publicKey, payload, signature);

    if (!isValid) {
      return {
        allowed: false,
        violated: {
          tier: 'T0',
          constraint: 'T0-3',
          message: `T0-3 BLOCKED: Invalid cryptographic signature for action "${action.action}". Action may be tampered.`,
          blockedAt: new Date().toISOString(),
          action,
        },
      };
    }

    return {
      allowed: true,
      signature,
    };
  }
}
