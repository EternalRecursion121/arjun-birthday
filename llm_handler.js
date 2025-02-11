const Anthropic = require('@anthropic-ai/sdk');
const dotenv = require('dotenv');

dotenv.config();

class LLMHandler {
    constructor() {
        this.client = new Anthropic({
            apiKey: process.env.CLAUDE_API_KEY
        });

        // Define memory management tool
        this.memoryTool = {
            type: "function",
            function: {
                name: "update_memory",
                description: "Update the bot's memory with new information",
                parameters: {
                    type: "object",
                    properties: {
                        add: { type: "object" },
                        update: { type: "object" },
                        delete: { type: "array", items: { type: "string" } }
                    }
                }
            }
        };
    }

    async getResponse(message, context) {
        try {
            console.log('LLMHandler.getResponse called with:', {
                messageLength: message?.length,
                contextLength: context?.length
            });

            if (!message || !context) {
                console.error('Invalid input to getResponse:', { message, context });
                return "sorry, something went wrong with processing your message";
            }

            console.log('Sending request to Claude...');
            const startTime = Date.now();
            
            const response = await this.client.messages.create({
                model: 'claude-3-sonnet-20240229',
                max_tokens: 300,
                temperature: 0.7,
                system: context + "\n\nKeep your responses concise and casual - aim for 3-4 sentences max.",
                messages: [{
                    role: 'user',
                    content: message
                }]
            }).catch(error => {
                console.error('Claude API error:', error);
                console.error('Error details:', {
                    message: error.message,
                    type: error.type,
                    status: error.status,
                    stack: error.stack
                });
                throw error;
            });

            const endTime = Date.now();
            console.log(`Claude response received in ${endTime - startTime}ms`);

            // Updated response parsing logic
            let replyText = "";
            // First check if there is a 'completion' field (as a string) to use as our reply
            if (typeof response.completion === 'string') {
                replyText = response.completion;
            } else if (response?.content && Array.isArray(response.content) && response.content[0]?.text) {
                replyText = response.content[0].text;
            } else {
                console.error('Invalid response format from Claude:', JSON.stringify(response, null, 2));
                throw new Error('Invalid response format from Claude');
            }
            
            console.log('Response:', replyText.slice(0, 100) + '...');
            return replyText;
        } catch (error) {
            console.error('Error in LLMHandler.getResponse:', error);
            console.error('Stack trace:', error.stack);
            return "sorry, i'm having trouble right now. could you try again in a moment?";
        }
    }

    async processMorningPlan(message, userData, chatHistory = null, memoryInstructions = null) {
        const context = this._getUserContext(userData);
        const memoryContext = memoryInstructions ? this._processMemoryInstructions(memoryInstructions) : "";
        const historyContext = chatHistory ? this._formatChatHistory(chatHistory) : "";

        const prompt = `Context: ${context}
The user is sharing their plan for today: ${message}

Your role:
1. give a friendly response (2-3 sentences)
2. ask a clarifying question if needed
3. offer one helpful suggestion if appropriate
4. note anything worth remembering

Keep responses casual and natural, but avoid long explanations.

for memory updates:
MEMORY_UPDATE: {
    "add": {"key": "value"},
    "update": {"existing_key": "new_value"},
    "delete": ["key_to_delete1", "key_to_delete2"]
}`;

        return await this._getResponse(prompt, chatHistory);
    }

    async processEveningReview(message, userData, chatHistory = null, memoryInstructions = null) {
        const context = this._getUserContext(userData);
        const memoryContext = memoryInstructions ? this._processMemoryInstructions(memoryInstructions) : "";
        const historyContext = chatHistory ? this._formatChatHistory(chatHistory) : "";

        const prompt = `Context: ${context}
The user is sharing about their day: ${message}

Your role:
1. acknowledge their day (1-2 sentences)
2. ask a follow-up question if needed
3. make a brief observation about what worked/didn't
4. note important things for memory

Keep responses under 4-5 sentences. Be casual but thoughtful.

for memory updates:
MEMORY_UPDATE: {
    "add": {"key": "value"},
    "update": {"existing_key": "new_value"},
    "delete": ["key_to_delete1", "key_to_delete2"]
}`;

        return await this._getResponse(prompt, chatHistory);
    }

    async processActivityCheck(message, userData, chatHistory = null, memoryInstructions = null) {
        const context = this._getUserContext(userData);
        const memoryContext = memoryInstructions ? this._processMemoryInstructions(memoryInstructions) : "";
        const historyContext = chatHistory ? this._formatChatHistory(chatHistory) : "";

        const prompt = `Context: ${context}
The user is sharing what they're working on: ${message}

Give a 2-3 sentence response. A quick acknowledgment and maybe one relevant question.
Keep it casual and natural.

for memory updates:
MEMORY_UPDATE: {
    "add": {"key": "value"},
    "update": {"existing_key": "new_value"},
    "delete": ["key_to_delete1", "key_to_delete2"]
}`;

        return await this._getResponse(prompt, chatHistory);
    }

    _getUserContext(userData) {
        return JSON.stringify(userData);
    }

    _formatChatHistory(chatHistory) {
        return chatHistory ? JSON.stringify(chatHistory) : "";
    }

    async _processMemoryInstructions(instructions) {
        // Implement memory management logic here
        return JSON.stringify(instructions);
    }

    async _getResponse(prompt, chatHistory) {
        try {
            const response = await this.client.messages.create({
                model: 'claude-3-sonnet-20240229',
                max_tokens: 1000,
                temperature: 0.7,
                system: prompt,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            });

            // Handle tool use if present
            if (response.stop_reason === "tool_calls") {
                for (const toolCall of response.content) {
                    if (toolCall.type === "tool_calls") {
                        const result = await this._executeTool(toolCall);
                        chatHistory.push({ role: response.role, content: response.content });
                        chatHistory.push({
                            role: "user",
                            content: [{
                                type: "tool_result",
                                tool_call_id: toolCall.id,
                                content: result
                            }]
                        });
                        return await this._getResponse(prompt, chatHistory);
                    }
                }
            }

            // Updated response parsing logic for _getResponse
            let replyText = "";
            if (typeof response.completion === 'string') {
                replyText = response.completion;
            } else if (response?.content && Array.isArray(response.content) && response.content[0]?.text) {
                replyText = response.content[0].text;
            } else {
                console.error('Invalid response format from Claude:', JSON.stringify(response, null, 2));
                throw new Error('Invalid response format from Claude');
            }
            return replyText;
        } catch (error) {
            console.error("Error getting Claude response:", error);
            return "sorry, having trouble processing that rn. could you try again?";
        }
    }

    async _executeTool(toolCall) {
        if (toolCall.function.name === "update_memory") {
            return await this._processMemoryInstructions(toolCall.function.arguments);
        }
        return `Error: Unknown tool ${toolCall.function.name}`;
    }
}

module.exports = { LLMHandler }; 