from typing import Dict, Optional, List
import datetime
from anthropic import Anthropic
import os
from dotenv import load_dotenv

load_dotenv()
CLAUDE_API_KEY = os.getenv('CLAUDE_API_KEY')

class LLMHandler:
    def __init__(self):
        self.client = Anthropic(api_key=CLAUDE_API_KEY)
        # This dictionary holds persistent memory entries.
        self.memory = {}
        # Define the memory management tool
        self.memory_tool = {
            "type": "function",
            "function": {
                "name": "update_memory",
                "description": "Update the bot's memory with new information",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "add": {"type": "object"},
                        "update": {"type": "object"},
                        "delete": {"type": "array", "items": {"type": "string"}}
                    }
                }
            }
        }

    async def process_morning_plan(
        self,
        message: str,
        user_data: Dict,
        chat_history: Optional[List[Dict]] = None,
        memory_instructions: Optional[Dict] = None
    ) -> str:
        """Process morning planning message and return response"""
        context = self._get_user_context(user_data)
        memory_context = self._process_memory_instructions(memory_instructions) if memory_instructions else ""
        history_context = self._format_chat_history(chat_history) if chat_history else ""
        
        prompt = f"""Context: {context}
The user is sharing their plan for today: {message}

Your role:
1. review their plan briefly but thoughtfully
2. ask any clarifying questions if needed
3. maybe suggest practical improvements
4. note anything worth remembering

keep it casual but focused on helping them have a productive day

if the plan seems clear and you have no questions:
END_CONVERSATION: true

if you want to discuss more:
END_CONVERSATION: false

for memory updates:
MEMORY_UPDATE: {{
    "add": {{"key": "value"}},
    "update": {{"existing_key": "new_value"}},
    "delete": ["key_to_delete1", "key_to_delete2"]
}}"""
        
        response = await self._get_claude_response(prompt, chat_history)
        return response

    async def process_evening_review(
        self,
        message: str,
        user_data: Dict,
        chat_history: Optional[List[Dict]] = None,
        memory_instructions: Optional[Dict] = None
    ) -> str:
        """Process evening review message and return response"""
        context = self._get_user_context(user_data)
        memory_context = self._process_memory_instructions(memory_instructions) if memory_instructions else ""
        history_context = self._format_chat_history(chat_history) if chat_history else ""
        
        prompt = f"""Context: {context}
The user is sharing about their day: {message}

Your role:
1. listen and understand what they did
2. ask about anything unclear
3. help them reflect on what worked/didnt work
4. note important things for memory

keep the tone casual but thoughtful. focus on learning and improvement rather than just praise

if you understand their day and have no more questions:
END_CONVERSATION: true

if you want to discuss more:
END_CONVERSATION: false

for memory updates:
MEMORY_UPDATE: {{
    "add": {{"key": "value"}},
    "update": {{"existing_key": "new_value"}},
    "delete": ["key_to_delete1", "key_to_delete2"]
}}"""
        
        response = await self._get_claude_response(prompt, chat_history)
        return response

    async def process_activity_check(
        self,
        message: str,
        user_data: Dict,
        chat_history: Optional[List[Dict]] = None,
        memory_instructions: Optional[Dict] = None
    ) -> str:
        context = self._get_user_context(user_data)
        memory_context = self._process_memory_instructions(memory_instructions) if memory_instructions else ""
        history_context = self._format_chat_history(chat_history) if chat_history else ""
        prompt = f"""Context: {context}
The user is sharing what they're working on: {message}

keep it brief and casual. maybe ask a quick clarifying question if relevant.

if you want to note anything:
MEMORY_UPDATE: {{
    "add": {{"key": "value"}},
    "update": {{"existing_key": "new_value"}},
    "delete": ["key_to_delete1", "key_to_delete2"]
}}"""
        
        response = await self._get_claude_response(prompt, chat_history)
        return response

    async def process_weekly_review(
        self,
        message: str,
        user_data: Dict,
        chat_history: Optional[List[Dict]] = None,
        memory_instructions: Optional[Dict] = None
    ) -> str:
        """Process weekly review messages and guide the conversation"""
        context = self._get_user_context(user_data)
        memory_context = self._process_memory_instructions(memory_instructions) if memory_instructions else ""
        history_context = self._format_chat_history(chat_history) if chat_history else ""
        
        prompt = f"""Context: {context}
The user is reviewing their week: {message}

Your role:
1. understand what they accomplished
2. ask about unclear points
3. help identify what worked/didnt work
4. note patterns or important learnings
5. think about adjustments for next week

keep the tone thoughtful but casual. focus on practical insights and improvements

if you understand their week and have no more questions:
END_CONVERSATION: true

if you want to discuss more:
END_CONVERSATION: false

for memory updates:
MEMORY_UPDATE: {{
    "add": {{"key": "value"}},
    "update": {{"existing_key": "new_value"}},
    "delete": ["key_to_delete1", "key_to_delete2"]
}}"""
        
        response = await self._get_claude_response(prompt, chat_history)
        return response

    async def process_weekly_plan(
        self,
        message: str,
        user_data: Dict,
        chat_history: Optional[List[Dict]] = None,
        memory_instructions: Optional[Dict] = None
    ) -> str:
        """Process weekly planning messages and guide goal setting"""
        context = self._get_user_context(user_data)
        memory_context = self._process_memory_instructions(memory_instructions) if memory_instructions else ""
        history_context = self._format_chat_history(chat_history) if chat_history else ""
        
        prompt = f"""Context: {context}
The user is sharing their weekly plan: {message}

Your role:
1. review their plan thoughtfully
2. ask about any unclear points
3. maybe suggest practical improvements
4. help them think through priorities
5. note important goals/deadlines

keep it focused but casual. aim to help them plan effectively without overcomplicating

if the plan seems solid and you have no questions:
END_CONVERSATION: true

if you want to discuss more:
END_CONVERSATION: false

for memory updates:
MEMORY_UPDATE: {{
    "add": {{"key": "value"}},
    "update": {{"existing_key": "new_value"}},
    "delete": ["key_to_delete1", "key_to_delete2"]
}}"""
        
        response = await self._get_claude_response(prompt, chat_history)
        return response

    def _get_user_context(self, user_data: Dict) -> str:
        """Generate context string from user data."""
        weekly_plans = user_data.get('weekly_plans', [])
        daily_logs = user_data.get('daily_logs', [])
        
        recent_logs = daily_logs[-5:] if daily_logs else []
        recent_plans = weekly_plans[-1] if weekly_plans else None
        
        context = f"""User's recent activity:
Latest weekly plan: {recent_plans}
Last {len(recent_logs)} daily logs: {recent_logs}"""
        return context

    def _process_memory_instructions(self, memory_instructions: Dict) -> str:
        """
        Process memory instructions in the form:
        {
            "add": {"key1": "value1", ...},
            "update": {"key2": "new value", ...},
            "delete": ["key3", ...]
        }
        Updates self.memory accordingly and returns a summary string.
        """
        instructions_str = ""
        if 'delete' in memory_instructions:
            for key in memory_instructions['delete']:
                if key in self.memory:
                    del self.memory[key]
                    instructions_str += f"Deleted memory for '{key}'. "
        if 'update' in memory_instructions:
            for key, value in memory_instructions['update'].items():
                self.memory[key] = value
                instructions_str += f"Updated memory for '{key}' to '{value}'. "
        if 'add' in memory_instructions:
            for key, value in memory_instructions['add'].items():
                self.memory[key] = value
                instructions_str += f"Added memory for '{key}': '{value}'. "
        return instructions_str

    def _format_chat_history(self, chat_history: List[Dict]) -> str:
        """Format a list of prior messages for inclusion in the prompt."""
        history_lines = []
        for msg in chat_history:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            history_lines.append(f"{role}: {content}")
        return "\n".join(history_lines)

    async def _get_claude_response(
        self,
        prompt: str,
        chat_history: Optional[List[Dict]] = None,
        tools: Optional[List[Dict]] = None
    ) -> Dict:
        """
        Constructs the message list for the API call and handles tool use.
        Returns the full response message instead of just content.
        """
        system_prompt = """You are Arjun, a friendly and thoughtful AI assistant focused on productivity and learning. Your personality traits:

- Communication style:
  - Direct and concise, using casual language
  - Often use "kk" and "alr" as acknowledgments
  - Break down complex thoughts into numbered points
  - Ask clarifying questions to better understand
  - Balance intellectual depth with approachability
  - Use lowercase and minimal punctuation
  - Sometimes split responses into multiple shorter messages

- Personality:
  - Genuinely curious about others' work and ideas
  - Thoughtful and analytical
  - Encouraging but not overly enthusiastic
  - Focus on practical understanding and learning
  - Balance between casual friendliness and getting things done

When responding:
1. Keep messages concise and direct
2. Use casual language but maintain clarity
3. Ask thoughtful follow-up questions
4. Break down complex ideas into clear points
5. Focus on practical next steps and learning opportunities"""

        messages = [{"role": "system", "content": system_prompt}]
        if chat_history:
            messages.extend(chat_history)
        messages.append({"role": "user", "content": prompt})
        
        try:
            response = await self.client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=1000,
                temperature=0.7,
                messages=messages,
                tools=tools if tools else [self.memory_tool]
            )
            
            # Handle tool use if present
            if response.stop_reason == "tool_use":
                for content in response.content:
                    if content.type == "tool_use":
                        # Execute the tool
                        result = await self._execute_tool(content)
                        
                        # Add tool result to messages
                        messages.append({"role": response.role, "content": response.content})
                        messages.append({
                            "role": "user",
                            "content": [{
                                "type": "tool_result",
                                "tool_use_id": content.id,
                                "content": result
                            }]
                        })
                        
                        # Get final response
                        return await self._get_claude_response(prompt, messages, tools)
            
            return response
            
        except Exception as e:
            print(f"Error getting Claude response: {e}")
            return {"content": "sorry, having trouble processing that rn. could you try again?"}

    async def _execute_tool(self, tool_use) -> str:
        """Execute the requested tool and return the result"""
        if tool_use.name == "update_memory":
            return await self._process_memory_instructions(tool_use.input)
        else:
            return f"Error: Unknown tool {tool_use.name}"

    async def process_message(
        self,
        message: str,
        user_data: Dict,
        chat_history: Optional[List[Dict]] = None,
        memory_instructions: Optional[Dict] = None
    ) -> str:
        """Process any message and determine appropriate response type"""
        context = self._get_user_context(user_data)
        memory_context = self._process_memory_instructions(memory_instructions) if memory_instructions else ""
        history_context = self._format_chat_history(chat_history) if chat_history else ""
        
        prompt = f"""Context: {context}
The user has sent this message: {message}

First, determine the type of message this is. It could be:
1. A morning plan
2. An evening review
3. An activity update
4. A weekly plan
5. A weekly review
6. A general message

Then, respond appropriately based on the message type. Your role is to:
1. Provide relevant feedback and guidance
2. Ask clarifying questions if needed
3. Suggest memory updates for important information
4. Keep the conversation engaging and supportive

If you have no more questions and the conversation can end, include:
END_CONVERSATION: true

If you need more information or want to continue the conversation, include:
END_CONVERSATION: false

Format any memory suggestions like this:
MEMORY_UPDATE: {{
    "add": {{"key": "value"}},
    "update": {{"existing_key": "new_value"}},
    "delete": ["key_to_delete1", "key_to_delete2"]
}}

Maintain a supportive and encouraging tone throughout the conversation."""
        
        response = await self._get_claude_response(prompt, chat_history)
        return response
