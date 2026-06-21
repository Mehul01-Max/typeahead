import crypto from 'crypto';

export default class ConsistentHash {
  constructor(replicaCount = 150) {
    this.replicaCount = replicaCount;
    this.ring = new Map();       // hash -> nodeId
    this.sortedKeys = [];        // sorted hash values for binary search
    this.nodes = new Set();
  }

  // md5 hash -> integer position on the ring
  _hash(str) {
    const md5 = crypto.createHash('md5').update(str).digest('hex');
    // take first 8 hex chars = 32 bits, enough for our ring
    return parseInt(md5.substring(0, 8), 16);
  }

  addNode(nodeId) {
    if (this.nodes.has(nodeId)) return;
    this.nodes.add(nodeId);

    for (let i = 0; i < this.replicaCount; i++) {
      const virtualKey = `${nodeId}:replica${i}`;
      const hash = this._hash(virtualKey);
      this.ring.set(hash, nodeId);
    }

    // rebuild sorted keys array
    this.sortedKeys = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  removeNode(nodeId) {
    if (!this.nodes.has(nodeId)) return;
    this.nodes.delete(nodeId);

    for (let i = 0; i < this.replicaCount; i++) {
      const virtualKey = `${nodeId}:replica${i}`;
      const hash = this._hash(virtualKey);
      this.ring.delete(hash);
    }

    this.sortedKeys = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  // find which node owns the given key
  getNode(key) {
    if (this.sortedKeys.length === 0) return null;

    const hash = this._hash(key);

    // binary search for the first ring position >= hash
    let low = 0;
    let high = this.sortedKeys.length - 1;
    let result = 0; // default wrap-around to first node

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.sortedKeys[mid] >= hash) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    // if hash is greater than all ring positions, wrap around
    if (low > this.sortedKeys.length - 1) {
      result = 0;
    }

    return this.ring.get(this.sortedKeys[result]);
  }

  // get debug info about where a key maps
  getDebugInfo(key) {
    const hash = this._hash(key);
    const node = this.getNode(key);
    return {
      key,
      hashValue: hash,
      assignedNode: node,
      totalNodes: this.nodes.size,
      totalVirtualNodes: this.sortedKeys.length,
      allNodes: Array.from(this.nodes)
    };
  }
}
