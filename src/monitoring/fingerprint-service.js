// src/monitoring/fingerprint-service.js
// SHA-256 output fingerprinting for prompt injection / model drift detection
// Phase 1.3: Behavioural Baseline & Anomaly Detection

const crypto = require('crypto');
const store = require('./store');

/**
 * FingerprintService - hashes agent outputs for integrity monitoring
 */
class FingerprintService {
  /**
   * Create a fingerprint hash from content
   * @param {string} content - The content to fingerprint
   * @param {Object} options - { agentId, sessionId, model }
   * @returns {Object} fingerprint entry
   */
  fingerprint(content, options = {}) {
    const hash = crypto
      .createHash('sha256')
      .update(content, 'utf8')
      .digest('hex');
    
    const fingerprint = {
      agentId: options.agentId || 'unknown',
      sessionId: options.sessionId || null,
      model: options.model || null,
      hash,
      contentLength: content.length,
      timestamp: new Date().toISOString(),
      truncatedContent: content.substring(0, 200)
    };
    
    // Store the fingerprint
    store.storeFingerprint(fingerprint);
    
    return fingerprint;
  }

  /**
   * Check if a fingerprint already exists for an agent
   * @param {string} agentId
   * @param {string} hash
   * @returns {boolean}
   */
  exists(agentId, hash) {
    return store.fingerprintExists(agentId, hash);
  }

  /**
   * Compare new content against historical fingerprints
   * @param {string} agentId
   * @param {string} content
   * @param {Object} options
   * @returns {Object} comparison result
   */
  compare(agentId, content, options = {}) {
    const hash = crypto
      .createHash('sha256')
      .update(content, 'utf8')
      .digest('hex');
    
    const existing = store.getFingerprints(agentId, 1000);
    
    // Find exact matches
    const exactMatch = existing.find(f => f.hash === hash);
    
    // Find similar hashes (different by 1-3 characters)
    const similarMatches = existing.filter(f => {
      if (f.hash === hash) return false;
      return this.hammingDistance(f.hash, hash) <= 3;
    });
    
    // Calculate content similarity
    const contentSimilarity = this.calculateContentSimilarity(
      content,
      existing.slice(0, 10).map(f => f.truncatedContent)
    );
    
    return {
      hash,
      exactMatch: !!exactMatch,
      similarMatchCount: similarMatches.length,
      contentSimilarity,
      isNovel: !exactMatch && similarMatches.length === 0,
      similarHashes: similarMatches.slice(0, 5).map(f => ({
        hash: f.hash,
        distance: this.hammingDistance(f.hash, hash),
        timestamp: f.timestamp
      }))
    };
  }

  /**
   * Calculate Hamming distance between two hex strings
   * @param {string} hash1
   * @param {string} hash2
   * @returns {number}
   */
  hammingDistance(hash1, hash2) {
    if (hash1.length !== hash2.length) {
      return Math.abs(hash1.length - hash2.length) * 4; // Approximate
    }
    
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      const b1 = parseInt(hash1[i], 16);
      const b2 = parseInt(hash2[i], 16);
      const xor = b1 ^ b2;
      // Count set bits
      while (xor) {
        distance += xor & 1;
        xor >>>= 1;
      }
    }
    return distance;
  }

  /**
   * Calculate content similarity using simple N-gram comparison
   * @param {string} content
   * @param {Array} existing
   * @returns {number} 0-1 similarity score
   */
  calculateContentSimilarity(content, existing) {
    if (existing.length === 0) return 0;
    
    const contentNgrams = this.getNgrams(content, 3);
    const contentSet = new Set(contentNgrams);
    
    let maxSimilarity = 0;
    
    for (const existingContent of existing) {
      const existingNgrams = this.getNgrams(existingContent, 3);
      const existingSet = new Set(existingNgrams);
      
      // Jaccard similarity
      const intersection = contentNgrams.filter(n => existingSet.has(n)).length;
      const union = new Set([...contentNgrams, ...existingNgrams]).size;
      
      const similarity = union > 0 ? intersection / union : 0;
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }
    
    return Math.round(maxSimilarity * 1000) / 1000;
  }

  /**
   * Get N-grams from content
   * @param {string} content
   * @param {number} n
   * @returns {Array}
   */
  getNgrams(content, n = 3) {
    const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
    const ngrams = [];
    for (let i = 0; i <= normalized.length - n; i++) {
      ngrams.push(normalized.substring(i, i + n));
    }
    return ngrams;
  }

  /**
   * Get fingerprint history for an agent
   * @param {string} agentId
   * @param {number} limit
   * @returns {Array}
   */
  getHistory(agentId, limit = 100) {
    return store.getFingerprints(agentId, limit);
  }

  /**
   * Detect potential prompt injection based on fingerprint patterns
   * @param {string} agentId
   * @param {Array} recentOutputs - array of {content, hash} objects
   * @returns {Object} detection result
   */
  detectPotentialInjection(agentId, recentOutputs) {
    const existing = store.getFingerprints(agentId, 100);
    const existingHashes = new Set(existing.map(f => f.hash));
    
    // Check for repeated outputs (could indicate replay attack)
    const outputHashes = recentOutputs.map(o => 
      crypto.createHash('sha256').update(o.content, 'utf8').digest('hex')
    );
    
    const repeats = outputHashes.filter((h, i) => outputHashes.indexOf(h) !== i);
    
    // Check for novel content (sudden changes could indicate injection)
    const novelOutputs = outputHashes.filter(h => !existingHashes.has(h));
    
    // Calculate diversity score
    const uniqueHashes = new Set(outputHashes);
    const diversityScore = uniqueHashes.size / Math.max(outputHashes.length, 1);
    
    return {
      agentId,
      analyzedOutputs: recentOutputs.length,
      uniqueHashes: uniqueHashes.size,
      repeats: repeats.length,
      novelOutputs: novelOutputs.length,
      diversityScore: Math.round(diversityScore * 1000) / 1000,
      isSuspicious: repeats.length > recentOutputs.length * 0.5 || diversityScore < 0.3,
      alertLevel: repeats.length > recentOutputs.length * 0.7 ? 'HIGH' : 
                  repeats.length > recentOutputs.length * 0.5 ? 'MEDIUM' : 
                  'LOW',
      timestamp: new Date().toISOString()
    };
  }
}