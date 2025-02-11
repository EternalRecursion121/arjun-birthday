const fs = require('fs').promises;
const path = require('path');

class MemoryHandler {
    constructor() {
        this.memoryPath = path.join(__dirname, 'data', 'users');
    }

    async addMemory(userId, type, content) {
        try {
            const memoryFile = path.join(this.memoryPath, userId, 'memory.json');
            let memories = await this.getMemories(userId);

            // Add new memory
            memories.push({
                timestamp: new Date().toISOString(),
                type: type,
                content: content,
                importance: this.calculateImportance(content)
            });

            // Sort by importance and timestamp
            memories.sort((a, b) => {
                if (b.importance !== a.importance) {
                    return b.importance - a.importance;
                }
                return new Date(b.timestamp) - new Date(a.timestamp);
            });

            await fs.writeFile(memoryFile, JSON.stringify(memories, null, 2));
        } catch (error) {
            console.error('Error adding memory:', error);
        }
    }

    async getMemories(userId) {
        try {
            const memoryFile = path.join(this.memoryPath, userId, 'memory.json');
            const data = await fs.readFile(memoryFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return [];
        }
    }

    calculateImportance(content) {
        // Simple importance calculation based on keywords
        const importantKeywords = [
            'goal', 'project', 'deadline', 'important', 'urgent',
            'meeting', 'milestone', 'problem', 'challenge', 'success',
            'failed', 'completed', 'started', 'planning', 'review'
        ];

        let importance = 0;
        importantKeywords.forEach(keyword => {
            if (content.toLowerCase().includes(keyword)) {
                importance += 1;
            }
        });

        return importance;
    }

    async getRelevantMemories(userId, currentContext, maxMemories = 50) {
        const memories = await this.getMemories(userId);
        
        // Simple relevance scoring based on keyword matching
        const scoredMemories = memories.map(memory => ({
            ...memory,
            relevance: this.calculateRelevance(memory.content, currentContext)
        }));

        // Sort by relevance and importance
        return scoredMemories
            .sort((a, b) => (b.relevance + b.importance) - (a.relevance + a.importance))
            .slice(0, maxMemories);
    }

    calculateRelevance(memoryContent, currentContext) {
        // Simple relevance calculation based on word overlap
        const memoryWords = new Set(memoryContent.toLowerCase().split(/\W+/));
        const contextWords = new Set(currentContext.toLowerCase().split(/\W+/));
        
        let overlap = 0;
        for (const word of memoryWords) {
            if (contextWords.has(word)) {
                overlap++;
            }
        }
        
        return overlap;
    }
}

module.exports = { MemoryHandler }; 