// JSDoc typedefs for elora-voss. Mirrors the spec's TS shape.

/**
 * @typedef {Object} SearchResult
 * @property {string} title
 * @property {string} url
 * @property {string} snippet
 */

/**
 * @typedef {Object} Fact
 * @property {string} claim
 * @property {"high"|"medium"|"low"} confidence
 */

/**
 * @typedef {Object} KnowledgeBase
 * @property {string} summary
 * @property {Fact[]} facts
 * @property {string[]} sources
 * @property {string[]} flagged
 */

/**
 * @typedef {Object} ImageItem
 * @property {string} url
 * @property {string} alt
 * @property {string} query
 * @property {"unsplash"|"pexels"} provider
 */

/**
 * @typedef {Object} Meta
 * @property {string} topic
 * @property {string} model
 * @property {number} wordCount
 * @property {string} generatedAt
 * @property {"duckduckgo"|"tavily"} searchProvider
 * @property {Record<string,string>} preferences
 */

/**
 * @typedef {Object} Output
 * @property {string} title
 * @property {string} article
 * @property {KnowledgeBase} knowledgeBase
 * @property {ImageItem[]} images
 * @property {Meta} meta
 */

export {};