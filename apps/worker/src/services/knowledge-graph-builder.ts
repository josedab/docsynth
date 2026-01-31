import { createLogger } from '@docsynth/utils';
import type { EntityType, RelationType } from '@docsynth/types';

const log = createLogger('knowledge-graph-builder');

interface ExtractedEntity {
  name: string;
  type: EntityType;
  description?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  metadata: Record<string, unknown>;
}

interface ExtractedRelation {
  fromEntity: string;
  toEntity: string;
  relationship: RelationType;
  weight: number;
  metadata: Record<string, unknown>;
}

interface DocumentContent {
  id: string;
  path: string;
  type: string;
  title: string;
  content: string;
}

interface CodeFile {
  path: string;
  content: string;
  language: string;
}

class KnowledgeGraphBuilderService {
  /**
   * Extract entities from documentation
   */
  extractEntitiesFromDocs(documents: DocumentContent[]): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const seen = new Set<string>();

    for (const doc of documents) {
      // Add document as entity
      const docKey = `document:${doc.id}`;
      if (!seen.has(docKey)) {
        seen.add(docKey);
        entities.push({
          name: doc.title,
          type: 'document',
          description: `${doc.type} documentation: ${doc.path}`,
          filePath: doc.path,
          metadata: {
            documentId: doc.id,
            documentType: doc.type,
          },
        });
      }

      // Extract concepts from content
      const concepts = this.extractConceptsFromMarkdown(doc.content);
      for (const concept of concepts) {
        const key = `${concept.type}:${concept.name.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          entities.push({
            ...concept,
            metadata: {
              ...concept.metadata,
              sourceDocumentId: doc.id,
            },
          });
        }
      }

      // Extract code entities from code blocks
      const codeEntities = this.extractCodeEntities(doc.content);
      for (const entity of codeEntities) {
        const key = `${entity.type}:${entity.name.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          entities.push({
            ...entity,
            metadata: {
              ...entity.metadata,
              sourceDocumentId: doc.id,
            },
          });
        }
      }
    }

    log.info({ count: entities.length }, 'Extracted entities from documentation');
    return entities;
  }

  /**
   * Extract entities from code files
   */
  extractEntitiesFromCode(files: CodeFile[]): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const seen = new Set<string>();

    for (const file of files) {
      // Add file as entity
      const fileKey = `file:${file.path}`;
      if (!seen.has(fileKey)) {
        seen.add(fileKey);
        entities.push({
          name: file.path.split('/').pop() || file.path,
          type: 'file',
          description: `Source file: ${file.path}`,
          filePath: file.path,
          metadata: {
            language: file.language,
            fullPath: file.path,
          },
        });
      }

      // Extract code entities based on language
      const codeEntities = this.extractCodeEntitiesFromFile(file);
      for (const entity of codeEntities) {
        const key = `${entity.type}:${entity.name.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          entities.push(entity);
        }
      }
    }

    log.info({ count: entities.length }, 'Extracted entities from code');
    return entities;
  }

  /**
   * Build relationships between entities
   */
  buildRelations(entities: ExtractedEntity[], documents: DocumentContent[]): ExtractedRelation[] {
    const relations: ExtractedRelation[] = [];
    const entityMap = new Map<string, ExtractedEntity>();

    // Build entity lookup map
    for (const entity of entities) {
      const key = `${entity.type}:${entity.name.toLowerCase()}`;
      entityMap.set(key, entity);
    }

    // Build document-to-entity relations
    for (const doc of documents) {
      const docEntity = entities.find((e) => e.type === 'document' && e.metadata.documentId === doc.id);

      if (!docEntity) continue;

      // Find mentioned entities in document
      for (const entity of entities) {
        if (entity.type === 'document') continue;

        const mentioned = this.isEntityMentioned(entity.name, doc.content);
        if (mentioned) {
          relations.push({
            fromEntity: docEntity.name,
            toEntity: entity.name,
            relationship: 'documents',
            weight: mentioned.count / 10, // Normalize by mention frequency
            metadata: { mentionCount: mentioned.count },
          });
        }
      }
    }

    // Build entity-to-entity relations based on co-occurrence
    const entityCooccurrence = this.calculateCooccurrence(entities, documents);
    for (const [pair, count] of entityCooccurrence) {
      const [entity1, entity2] = pair.split('|||');
      if (entity1 && entity2 && count > 1) {
        relations.push({
          fromEntity: entity1,
          toEntity: entity2,
          relationship: 'related',
          weight: Math.min(count / 5, 1),
          metadata: { cooccurrenceCount: count },
        });
      }
    }

    // Build code-specific relations
    const codeRelations = this.buildCodeRelations(entities);
    relations.push(...codeRelations);

    log.info({ count: relations.length }, 'Built entity relations');
    return relations;
  }

  /**
   * Extract concepts from markdown content
   */
  private extractConceptsFromMarkdown(content: string): ExtractedEntity[] {
    const concepts: ExtractedEntity[] = [];

    // Extract headings as concepts
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1]!.length;
        const title = headingMatch[2]!.trim();

        // Skip very short or very long headings
        if (title.length >= 3 && title.length <= 100) {
          concepts.push({
            name: title,
            type: 'concept',
            description: `Section heading (level ${level})`,
            lineStart: i + 1,
            lineEnd: i + 1,
            metadata: { headingLevel: level },
          });
        }
      }
    }

    // Extract bold terms as potential concepts
    const boldRegex = /\*\*([^*]+)\*\*/g;
    let match: RegExpExecArray | null;
    while ((match = boldRegex.exec(content)) !== null) {
      const term = match[1]?.trim();
      if (term && term.length >= 3 && term.length <= 50 && !concepts.some((c) => c.name.toLowerCase() === term.toLowerCase())) {
        concepts.push({
          name: term,
          type: 'concept',
          description: 'Emphasized term',
          metadata: { emphasis: 'bold' },
        });
      }
    }

    return concepts.slice(0, 50); // Limit concepts per document
  }

  /**
   * Extract code entities from markdown code blocks
   */
  private extractCodeEntities(content: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const language = match[1] || 'text';
      const code = match[2] || '';

      const codeEntities = this.parseCodeForEntities(code, language);
      entities.push(...codeEntities);
    }

    return entities;
  }

  /**
   * Extract entities from a code file
   */
  private extractCodeEntitiesFromFile(file: CodeFile): ExtractedEntity[] {
    return this.parseCodeForEntities(file.content, file.language, file.path);
  }

  /**
   * Parse code to extract functions, classes, interfaces, etc.
   */
  private parseCodeForEntities(code: string, language: string, filePath?: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const lines = code.split('\n');

    switch (language) {
      case 'typescript':
      case 'javascript':
      case 'ts':
      case 'js':
        entities.push(...this.parseJavaScriptEntities(code, lines, filePath));
        break;
      case 'python':
      case 'py':
        entities.push(...this.parsePythonEntities(code, lines, filePath));
        break;
      case 'go':
      case 'golang':
        entities.push(...this.parseGoEntities(code, lines, filePath));
        break;
    }

    return entities;
  }

  /**
   * Parse JavaScript/TypeScript for entities
   */
  private parseJavaScriptEntities(code: string, lines: string[], filePath?: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    // Functions
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
    let match;
    while ((match = funcRegex.exec(code)) !== null) {
      if (match[1]) {
        const lineNum = this.getLineNumber(code, match.index);
        entities.push({
          name: match[1],
          type: 'function',
          filePath,
          lineStart: lineNum,
          metadata: { async: code.substring(match.index - 10, match.index).includes('async') },
        });
      }
    }

    // Arrow functions with const/let
    const arrowRegex = /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/g;
    while ((match = arrowRegex.exec(code)) !== null) {
      if (match[1]) {
        const lineNum = this.getLineNumber(code, match.index);
        entities.push({
          name: match[1],
          type: 'function',
          filePath,
          lineStart: lineNum,
          metadata: { arrow: true },
        });
      }
    }

    // Classes
    const classRegex = /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g;
    while ((match = classRegex.exec(code)) !== null) {
      if (match[1]) {
        const lineNum = this.getLineNumber(code, match.index);
        entities.push({
          name: match[1],
          type: 'class',
          filePath,
          lineStart: lineNum,
          metadata: { extends: match[2] },
        });
      }
    }

    // Interfaces
    const interfaceRegex = /(?:export\s+)?interface\s+(\w+)/g;
    while ((match = interfaceRegex.exec(code)) !== null) {
      if (match[1]) {
        const lineNum = this.getLineNumber(code, match.index);
        entities.push({
          name: match[1],
          type: 'interface',
          filePath,
          lineStart: lineNum,
          metadata: {},
        });
      }
    }

    // Types
    const typeRegex = /(?:export\s+)?type\s+(\w+)\s*=/g;
    while ((match = typeRegex.exec(code)) !== null) {
      if (match[1]) {
        const lineNum = this.getLineNumber(code, match.index);
        entities.push({
          name: match[1],
          type: 'type',
          filePath,
          lineStart: lineNum,
          metadata: {},
        });
      }
    }

    return entities;
  }

  /**
   * Parse Python for entities
   */
  private parsePythonEntities(code: string, lines: string[], filePath?: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    // Functions
    const funcRegex = /def\s+(\w+)\s*\(/g;
    let match;
    while ((match = funcRegex.exec(code)) !== null) {
      if (match[1] && !match[1].startsWith('_')) {
        const lineNum = this.getLineNumber(code, match.index);
        entities.push({
          name: match[1],
          type: 'function',
          filePath,
          lineStart: lineNum,
          metadata: {},
        });
      }
    }

    // Classes
    const classRegex = /class\s+(\w+)(?:\([^)]*\))?:/g;
    while ((match = classRegex.exec(code)) !== null) {
      if (match[1]) {
        const lineNum = this.getLineNumber(code, match.index);
        entities.push({
          name: match[1],
          type: 'class',
          filePath,
          lineStart: lineNum,
          metadata: {},
        });
      }
    }

    return entities;
  }

  /**
   * Parse Go for entities
   */
  private parseGoEntities(code: string, lines: string[], filePath?: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    // Functions
    const funcRegex = /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/g;
    let match;
    while ((match = funcRegex.exec(code)) !== null) {
      if (match[1]) {
        const lineNum = this.getLineNumber(code, match.index);
        entities.push({
          name: match[1],
          type: 'function',
          filePath,
          lineStart: lineNum,
          metadata: {},
        });
      }
    }

    // Types/Structs
    const typeRegex = /type\s+(\w+)\s+(?:struct|interface)/g;
    while ((match = typeRegex.exec(code)) !== null) {
      if (match[1]) {
        const lineNum = this.getLineNumber(code, match.index);
        entities.push({
          name: match[1],
          type: code.includes(`type ${match[1]} struct`) ? 'class' : 'interface',
          filePath,
          lineStart: lineNum,
          metadata: {},
        });
      }
    }

    return entities;
  }

  /**
   * Get line number from character index
   */
  private getLineNumber(content: string, index: number): number {
    return content.substring(0, index).split('\n').length;
  }

  /**
   * Check if entity is mentioned in content
   */
  private isEntityMentioned(entityName: string, content: string): { count: number } | null {
    const regex = new RegExp(`\\b${this.escapeRegex(entityName)}\\b`, 'gi');
    const matches = content.match(regex);
    return matches ? { count: matches.length } : null;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Calculate co-occurrence of entities in documents
   */
  private calculateCooccurrence(
    entities: ExtractedEntity[],
    documents: DocumentContent[]
  ): Map<string, number> {
    const cooccurrence = new Map<string, number>();

    for (const doc of documents) {
      const mentionedEntities = entities.filter(
        (e) => e.type !== 'document' && this.isEntityMentioned(e.name, doc.content)
      );

      // Count pairs
      for (let i = 0; i < mentionedEntities.length; i++) {
        for (let j = i + 1; j < mentionedEntities.length; j++) {
          const pair = [mentionedEntities[i]!.name, mentionedEntities[j]!.name].sort().join('|||');
          cooccurrence.set(pair, (cooccurrence.get(pair) || 0) + 1);
        }
      }
    }

    return cooccurrence;
  }

  /**
   * Build code-specific relations (extends, implements, etc.)
   */
  private buildCodeRelations(entities: ExtractedEntity[]): ExtractedRelation[] {
    const relations: ExtractedRelation[] = [];

    for (const entity of entities) {
      // Handle class inheritance
      if (entity.type === 'class' && entity.metadata.extends) {
        const parent = entities.find(
          (e) => e.name === entity.metadata.extends && (e.type === 'class' || e.type === 'interface')
        );
        if (parent) {
          relations.push({
            fromEntity: entity.name,
            toEntity: parent.name,
            relationship: 'extends',
            weight: 1,
            metadata: {},
          });
        }
      }
    }

    return relations;
  }
}

export const knowledgeGraphBuilderService = new KnowledgeGraphBuilderService();
