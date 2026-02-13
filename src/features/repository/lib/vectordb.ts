export interface Document {
  id: string;
  source: string;
  vector: number[];
  text: string;
}

export interface QueryResult {
  document: Document;
  similarity: number;
}

// vectordb.ts
export class VectorDB {
  private documents: Map<string, Document> = new Map();

  constructor() {
  }

  addDocument(document: Document): void {
    this.documents.set(document.id, document);
  }
  
  private cosineSimilarity(vector1: number[], vector2: number[]): number {
    if (vector1.length !== vector2.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vector1.length; i++) {
      dotProduct += vector1[i] * vector2[i];
      norm1 += vector1[i] * vector1[i];
      norm2 += vector2[i] * vector2[i];
    }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

    // Handle zero vectors
    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (norm1 * norm2);
  }
  
  queryDocuments(vector: number[], topK?: number): QueryResult[] {
    const k = topK || 10;
    
    const similarities: QueryResult[] = [];

    for (const document of this.documents.values()) {
      try {
        const similarity = this.cosineSimilarity(vector, document.vector);
        similarities.push({ document, similarity });
      } catch (error) {
        console.warn(`Error calculating similarity for document ${document.id}:`, error);
        continue;
      }
    }

    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities.slice(0, k);
  }
  
  getDocument(docId: string): Document | undefined {
    return this.documents.get(docId);
  }
  
  listDocuments(): Document[] {
    return Array.from(this.documents.values());
  }
  
  deleteDocument(docId: string): boolean {
    return this.documents.delete(docId);
  }
  
  clear(): void {
    this.documents.clear();
  }
  
  export(): string {
    const data = Object.fromEntries(this.documents.entries());
    return JSON.stringify(data);
  }
  
  import(jsonData: string): void {
    try {
      const data = JSON.parse(jsonData) as Record<string, Document>;
      
      this.clear();

      for (const doc of Object.values(data)) {
        this.addDocument(doc);
      }
    } catch (error) {
      throw new Error(`Failed to import database: ${error}`);
    }
  }
}