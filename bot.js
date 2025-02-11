const { Client, GatewayIntentBits, Events, REST, Routes, ChannelType } = require('discord.js');
const dotenv = require('dotenv');
const { LLMHandler } = require('./llm_handler.js');
const { ClockifyHandler } = require('./clockify_handler.js');
const schedule = require('node-schedule');
const fs = require('fs').promises;
const path = require('path');
const { MemoryHandler } = require('./memory_handler.js');

dotenv.config();

// Add this line to verify environment variables are loaded
console.log('Environment variables loaded:', {
    debug: process.env.DEBUG,
    clientId: process.env.CLIENT_ID,
    hasToken: !!process.env.DISCORD_TOKEN
});

class ArjunBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.DirectMessageTyping,
                GatewayIntentBits.DirectMessageReactions,
                GatewayIntentBits.MessageContent
            ]
        });

        this.llmHandler = new LLMHandler();
        this.clockifyHandler = null;
        this.memoryHandler = new MemoryHandler();

        // Default configuration
        this.defaultConfig = {
            morningCheckHour: 9,
            eveningReviewHour: 21,
            weeklyReviewDay: "SUNDAY",
            weeklyReviewHour: 18,
            activityCheckInterval: 30,
            activityCheckProbability: 0.3,
            timezone: "UTC",
            clockifyApiKey: null,
            clockifyEnabled: false
        };

        // Messages in Arjun's style
        this.morningMessages = [
            "hey, what are you planning to work on today?",
            "what are you thinking of getting done today?",
            "hey there, what's the plan for today?"
        ];

        this.eveningMessages = [
            "hey, how did your day go?",
            "what did you end up working on today?",
            "how was your day? what worked/didnt work?",
            "lets review what you got done today"
        ];

        this.activityCheckMessages = [
            "what are you working on rn?",
            "hey, hows the current task going?",
            "quick check - what are you up to?"
        ];

        // Move command definitions to class level
        this.commands = [
            {
                name: 'begin',
                description: 'start tracking your productivity'
            },
            {
                name: 'config',
                description: 'see your current settings'
            },
            {
                name: 'set_time',
                description: 'change when i check in with you',
                options: [
                    {
                        name: 'check_type',
                        description: 'Type of check',
                        type: 3, // STRING
                        required: true,
                        choices: [
                            { name: 'morning_check', value: 'morning_check' },
                            { name: 'evening_review', value: 'evening_review' }
                        ]
                    },
                    {
                        name: 'hour',
                        description: 'Hour in 24-hour format',
                        type: 4, // INTEGER
                        required: true,
                        min_value: 0,
                        max_value: 23
                    }
                ]
            },
            {
                name: 'help',
                description: 'shows all available commands and how to use them'
            },
            {
                name: 'export_data',
                description: 'get all your data as a JSON file'
            },
            {
                name: 'set_check_probability',
                description: 'change how often I check in randomly (0-100%)',
                options: [
                    {
                        name: 'probability',
                        description: 'Percentage chance of checking in each hour (0-100)',
                        type: 4, // INTEGER
                        required: true,
                        min_value: 0,
                        max_value: 100
                    }
                ]
            }
        ];

        // Add test commands only if DEBUG is true
        if (process.env.DEBUG === 'true') {
            const testCommands = [
                {
                    name: 'test_morning',
                    description: 'test the morning check message'
                },
                {
                    name: 'test_evening',
                    description: 'test the evening review message'
                },
                {
                    name: 'test_activity',
                    description: 'test the random activity check message'
                },
                {
                    name: 'test_weekly',
                    description: 'test the weekly review message'
                }
            ];
            this.commands.push(...testCommands);
        }

        // Create data directory if it doesn't exist
        this.ensureDataDirectories();

        // Create temp directory for file exports
        this.tempDir = path.join(__dirname, 'temp');
        this.ensureTempDirectory();

        // Set up event handlers
        this.setupEventHandlers();
        // Start interval checks
        this.scheduleChecks();

        // Add initial logging
        console.log('Bot initializing...');

        this.client.on('debug', console.log);
        this.client.on('error', console.error);
    }

    setupEventHandlers() {
        this.client.once(Events.ClientReady, async () => {
            console.log(`Logged in as ${this.client.user.tag}`);
            await this.registerCommands();
            this.scheduleChecks();
        });

        this.client.on(Events.InteractionCreate, async interaction => {
            if (!interaction.isChatInputCommand()) return;
            await this.handleCommand(interaction);
        });

        this.client.on(Events.MessageCreate, async message => {
            console.log('Message received:', {
                content: message.content,
                author: message.author?.tag,
                bot: message.author?.bot,
                channelType: message.channel?.type,
                isDM: message.channel?.type === ChannelType.DM
            });

            if (message.author.bot) {
                console.log('Ignoring bot message');
                return;
            }
            
            if (message.channel.type === ChannelType.DM) {
                console.log('Processing DM message');
                try {
                    // Initialize user data if it doesn't exist
                    const config = await this.getUserConfig(message.author.id);
                    console.log('User config:', config);

                    if (!config) {
                        console.log('Creating new user config');
                        const newConfig = { ...this.defaultConfig };
                        await this.saveUserConfig(message.author.id, newConfig);
                        await message.reply("hey! i noticed you haven't set up yet. i've created default settings for you - use /config to see them!");
                    }
                    
                    console.log('Handling DM...');
                    await this.handleDM(message);
                } catch (error) {
                    console.error('Error processing DM:', error);
                    console.error('Stack trace:', error.stack);
                    await message.reply("sorry, something went wrong! try again?").catch(console.error);
                }
            } else {
                console.log('Ignoring non-DM message');
            }
        });

        // Clean up temp files on shutdown
        process.on('SIGINT', async () => {
            await this.cleanupTempFiles();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            await this.cleanupTempFiles();
            process.exit(0);
        });
    }

    async registerCommands() {
        try {
            console.log('Started refreshing application (/) commands.');
            console.log('DEBUG environment variable:', process.env.DEBUG);
            console.log('Is DEBUG true?:', process.env.DEBUG === 'true');
            
            const rest = new REST().setToken(process.env.DISCORD_TOKEN);
            const CLIENT_ID = process.env.CLIENT_ID;
            
            // Log the commands being registered for debugging
            console.log('Commands array before registration:', this.commands.map(cmd => cmd.name));
            console.log('Full commands:', JSON.stringify(this.commands, null, 2));
            
            const response = await rest.put(
                Routes.applicationCommands(CLIENT_ID),
                { body: this.commands }
            );
            
            console.log('Successfully reloaded application (/) commands.');
            console.log('Registered commands:', response.length);
        } catch (error) {
            console.error('Error registering commands:', error);
            if (error.rawError) {
                console.error('API Error:', JSON.stringify(error.rawError, null, 2));
            }
        }
    }

    async ensureDataDirectories() {
        try {
            await fs.mkdir(path.join(__dirname, 'data', 'users'), { recursive: true });
        } catch (error) {
            console.error('Error creating data directories:', error);
        }
    }

    async getUserConfig(userId) {
        try {
            const configPath = path.join(__dirname, 'data', 'users', userId, 'config.json');
            const data = await fs.readFile(configPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // Return default config if file doesn't exist
            return { ...this.defaultConfig };
        }
    }

    async getUserMessages(userId) {
        try {
            const messagesPath = path.join(__dirname, 'data', 'users', userId, 'messages.json');
            const data = await fs.readFile(messagesPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // Return empty message history if file doesn't exist
            return {
                morning: [],
                evening: [],
                activity: [],
                weekly: [],
                conversation: []
            };
        }
    }

    async saveUserConfig(userId, config) {
        try {
            const userDir = path.join(__dirname, 'data', 'users', userId);
            await fs.mkdir(userDir, { recursive: true });
            const configPath = path.join(userDir, 'config.json');
            await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        } catch (error) {
            console.error(`Error saving config for user ${userId}:`, error);
        }
    }

    async saveUserMessage(userId, type, message) {
        try {
            const userDir = path.join(__dirname, 'data', 'users', userId);
            await fs.mkdir(userDir, { recursive: true });
            const messagesPath = path.join(userDir, 'messages.json');
            
            let messages = await this.getUserMessages(userId);
            messages[type].push({
                timestamp: new Date().toISOString(),
                message: message
            });
            
            await fs.writeFile(messagesPath, JSON.stringify(messages, null, 2));
        } catch (error) {
            console.error(`Error saving message for user ${userId}:`, error);
        }
    }

    async getAllUserIds() {
        try {
            const usersDir = path.join(__dirname, 'data', 'users');
            const users = await fs.readdir(usersDir);
            return users;
        } catch (error) {
            console.error('Error reading users directory:', error);
            return [];
        }
    }

    async scheduleChecks() {
        const userIds = await this.getAllUserIds();
        for (const userId of userIds) {
            const config = await this.getUserConfig(userId);
            const timezone = config.timezone;

            // Morning check
            schedule.scheduleJob(`morning-${userId}`, 
                { hour: config.morningCheckHour, minute: 0, tz: timezone }, 
                () => this.morningCheck(userId));

            // Evening check
            schedule.scheduleJob(`evening-${userId}`, 
                { hour: config.eveningReviewHour, minute: 0, tz: timezone }, 
                () => this.eveningCheck(userId));

            // Weekly review
            schedule.scheduleJob(`weekly-${userId}`, 
                { dayOfWeek: this.getDayNumber(config.weeklyReviewDay), 
                  hour: config.weeklyReviewHour, minute: 0, tz: timezone }, 
                () => this.weeklyReviewCheck(userId));

            // Activity checks
            for (let hour = config.morningCheckHour; hour <= config.eveningReviewHour; hour++) {
                schedule.scheduleJob(`activity-${userId}-${hour}`, 
                    { hour: hour, minute: 0, tz: timezone }, 
                    () => this.activityCheck(userId));
            }
        }
    }

    async morningCheck(userId) {
        try {
            const user = await this.client.users.fetch(userId);
            const message = this.morningMessages[Math.floor(Math.random() * this.morningMessages.length)];
            const response = await user.send(message);
            await this.saveUserMessage(userId, 'morning', message);
            
            // Wait for user's response
            const filter = m => m.author.id === userId;
            const collected = await response.channel.awaitMessages({ filter, max: 1, time: 300000 });
            
            if (collected.size > 0) {
                const userResponse = collected.first().content;
                const prompt = `The user has shared their plans for today: "${userResponse}"

If these plans reveal something important about the user's goals, work style, or patterns that would be helpful to remember, create a brief memory summary starting with "User". Otherwise, respond with "null".

Include your memory in <MEMORY> tags if you want to create one.

Respond in a casual, friendly way to their plans.`;
                
                const botResponse = await this.llmHandler.getResponse(prompt, "You are a casual, friendly productivity assistant.");
                
                // Extract and save memory before cleaning response
                const memoryMatch = botResponse.match(/<MEMORY>[\s\S]*?<\/MEMORY>/g);
                if (memoryMatch) {
                    // Handle each memory block
                    for (const memoryBlock of memoryMatch) {
                        const memoryContent = memoryBlock.replace(/<\/?MEMORY>/g, '').trim();
                        await this.memoryHandler.addMemory(
                            userId,
                            'morning_plans',
                            memoryContent
                        );
                        console.log('Memory saved:', memoryContent);
                    }
                }

                // Clean all memory tags from response
                const cleanResponse = botResponse.replace(/<MEMORY>[\s\S]*?<\/MEMORY>/g, '').trim();
                if (cleanResponse && cleanResponse.toLowerCase() !== 'null') {
                    await user.send(cleanResponse);
                }
            }
        } catch (error) {
            console.error(`Error in morning check for user ${userId}:`, error);
        }
    }

    async eveningCheck(userId) {
        try {
            const user = await this.client.users.fetch(userId);
            const message = this.eveningMessages[Math.floor(Math.random() * this.eveningMessages.length)];
            const response = await user.send(message);
            await this.saveUserMessage(userId, 'evening', message);
            
            // Wait for user's response and create a memory
            const filter = m => m.author.id === userId;
            const collected = await response.channel.awaitMessages({ filter, max: 1, time: 300000 }); // 5 min timeout
            
            if (collected.size > 0) {
                const userResponse = collected.first().content;
                const memoryPrompt = `Based on the user's evening review: "${userResponse}"
Create a brief, meaningful summary of their day's achievements, challenges, or insights. Format as a single concise sentence starting with "User".`;
                
                const memorySummary = await this.llmHandler.getResponse(memoryPrompt, "You are a helpful assistant that creates concise memory summaries.");
                
                if (memorySummary && memorySummary.toLowerCase() !== "null") {
                    await this.memoryHandler.addMemory(
                        userId,
                        'evening_review',
                        memorySummary
                    );
                }
            }
        } catch (error) {
            console.error(`Error in evening check for user ${userId}:`, error);
        }
    }

    async activityCheck(userId) {
        try {
            const user = await this.client.users.fetch(userId);
            const config = await this.getUserConfig(userId);
            
            if (Math.random() < config.activityCheckProbability) {
                const message = this.activityCheckMessages[Math.floor(Math.random() * this.activityCheckMessages.length)];
                await user.send(message);
                await this.saveUserMessage(userId, 'activity', message);
                
                // Save to memory if it's important
                if (this.memoryHandler.calculateImportance(message) > 0) {
                    await this.memoryHandler.addMemory(userId, 'activity_check', message);
                }
            }
        } catch (error) {
            console.error(`Error in activity check for user ${userId}:`, error);
        }
    }

    async weeklyReviewCheck(userId) {
        try {
            const user = await this.client.users.fetch(userId);
            const message = "hey, let's do our weekly review! how did this week go overall?";
            await user.send(message);
            await this.saveUserMessage(userId, 'weekly', message);
            
            // Save to memory if it's important
            if (this.memoryHandler.calculateImportance(message) > 0) {
                await this.memoryHandler.addMemory(userId, 'weekly_review', message);
            }
        } catch (error) {
            console.error(`Error in weekly review check for user ${userId}:`, error);
        }
    }

    getDayNumber(day) {
        const days = {
            'SUNDAY': 0,
            'MONDAY': 1,
            'TUESDAY': 2,
            'WEDNESDAY': 3,
            'THURSDAY': 4,
            'FRIDAY': 5,
            'SATURDAY': 6
        };
        return days[day.toUpperCase()] || 0;
    }

    start() {
        this.client.login(process.env.DISCORD_TOKEN);
    }

    async handleCommand(interaction) {
        try {
            switch (interaction.commandName) {
                case 'help':
                    await interaction.reply({
                        content: `Here are all my commands:
                        
/begin - Start tracking your productivity
/config - See your current settings
/set_time - Change when I check in with you
/help - Show this help message
/export_data - Get all your data as a JSON file

For more detailed help, DM me with your questions!`,
                        ephemeral: true
                    });
                    break;

                case 'begin':
                    const config = { ...this.defaultConfig };
                    await this.saveUserConfig(interaction.user.id, config);
                    await this.scheduleChecks();
                    await interaction.reply({
                        content: "hey! i'll start tracking your productivity and checking in with you regularly. you can use /config to see your current settings!",
                        ephemeral: true
                    });
                    break;

                case 'config':
                    const userData = await this.getUserConfig(interaction.user.id);
                    if (!userData) {
                        await interaction.reply({
                            content: "you haven't started yet! use /begin to get started.",
                            ephemeral: true
                        });
                        return;
                    }

                    await interaction.reply({
                        content: `here are your current settings:
                        
morning check: ${userData.morningCheckHour}:00
evening review: ${userData.eveningReviewHour}:00
weekly review: ${userData.weeklyReviewDay} at ${userData.weeklyReviewHour}:00
random check probability: ${Math.round(userData.activityCheckProbability * 100)}%
timezone: ${userData.timezone}

use /set_time to change when i check in with you!
use /set_check_probability to change how often i randomly check in!`,
                        ephemeral: true
                    });
                    break;

                case 'set_time':
                    const user = await this.getUserConfig(interaction.user.id);
                    if (!user) {
                        await interaction.reply({
                            content: "you haven't started yet! use /begin to get started.",
                            ephemeral: true
                        });
                        return;
                    }

                    const checkType = interaction.options.getString('check_type');
                    const hour = interaction.options.getInteger('hour');

                    if (checkType === 'morning_check') {
                        user.morningCheckHour = hour;
                    } else if (checkType === 'evening_review') {
                        user.eveningReviewHour = hour;
                    }

                    await this.saveUserConfig(interaction.user.id, user);
                    await this.scheduleChecks();
                    await interaction.reply({
                        content: `updated! i'll now do your ${checkType.replace('_', ' ')} at ${hour}:00`,
                        ephemeral: true
                    });
                    break;

                case 'test_morning':
                    await interaction.reply({
                        content: "sending a test morning check message...",
                        ephemeral: true
                    });
                    await interaction.user.send(this.morningMessages[Math.floor(Math.random() * this.morningMessages.length)]);
                    break;

                case 'test_evening':
                    await interaction.reply({
                        content: "sending a test evening review message...",
                        ephemeral: true
                    });
                    await interaction.user.send(this.eveningMessages[Math.floor(Math.random() * this.eveningMessages.length)]);
                    break;

                case 'test_activity':
                    await interaction.reply({
                        content: "sending a test activity check message...",
                        ephemeral: true
                    });
                    await interaction.user.send(this.activityCheckMessages[Math.floor(Math.random() * this.activityCheckMessages.length)]);
                    break;

                case 'test_weekly':
                    await interaction.reply({
                        content: "sending a test weekly review message...",
                        ephemeral: true
                    });
                    await interaction.user.send("hey, let's do our weekly review! how did this week go overall?");
                    break;

                case 'export_data':
                    try {
                        const filePath = await this.exportUserData(interaction.user.id);
                        
                        // Send the file
                        await interaction.reply({
                            content: "here's all your data! you can use this to backup or transfer your data.",
                            files: [{
                                attachment: filePath,
                                name: 'your_data.json',
                                description: 'Your exported data including settings, messages, and memories'
                            }],
                            ephemeral: true
                        });

                        // Clean up the temporary file
                        fs.unlink(filePath).catch(console.error);
                    } catch (error) {
                        console.error('Error handling export_data command:', error);
                        await interaction.reply({
                            content: 'sorry, something went wrong while exporting your data!',
                            ephemeral: true
                        });
                    }
                    break;

                case 'set_check_probability':
                    const userConfigData = await this.getUserConfig(interaction.user.id);
                    if (!userConfigData) {
                        await interaction.reply({
                            content: "you haven't started yet! use /begin to get started.",
                            ephemeral: true
                        });
                        return;
                    }

                    const probability = interaction.options.getInteger('probability');
                    userConfigData.activityCheckProbability = probability / 100; // Convert percentage to decimal
                    
                    await this.saveUserConfig(interaction.user.id, userConfigData);
                    await this.scheduleChecks(); // Reschedule checks with new probability
                    
                    await interaction.reply({
                        content: `got it! i'll now have a ${probability}% chance of checking in each hour between your morning and evening checks`,
                        ephemeral: true
                    });
                    break;

                default:
                    await interaction.reply({
                        content: "sorry, i don't recognize that command. use /help to see all available commands!",
                        ephemeral: true
                    });
            }
        } catch (error) {
            console.error('Error handling command:', error);
            await interaction.reply({
                content: 'sorry, something went wrong! please try again later.',
                ephemeral: true
            }).catch(console.error);
        }
    }

    rescheduleUserChecks(userId) {
        // Cancel existing schedules for this user
        schedule.scheduledJobs[`morning-${userId}`]?.cancel();
        schedule.scheduledJobs[`evening-${userId}`]?.cancel();
        schedule.scheduledJobs[`weekly-${userId}`]?.cancel();
        
        // Schedule new checks
        this.scheduleChecks();
    }

    async handleDM(message) {
        try {
            await message.channel.sendTyping().catch(console.error);
            console.log(`Processing DM from ${message.author.tag}: ${message.content}`);

            // Fetch recent messages from the DM channel
            const messages = await message.channel.messages.fetch({ limit: 50 });
            console.log('Retrieved message history from Discord');
            
            // Format conversation history for Claude, excluding the current message
            const conversationHistory = messages
                .filter(msg => msg.id !== message.id) // Exclude current message
                .sort((a, b) => a.createdTimestamp - b.createdTimestamp) // Sort by timestamp
                .map(msg => {
                    if (msg.author.id === this.client.user.id) {
                        return `Assistant: ${msg.content}`;
                    } else {
                        return `Human: ${msg.content}`;
                    }
                })
                .join('\n');

            // Get relevant long-term memories
            const relevantMemories = await this.memoryHandler.getRelevantMemories(
                message.author.id,
                message.content
            );

            // Format memories for context
            const memoriesContext = relevantMemories.map(m => 
                `Previous ${m.type}: ${m.content}`
            ).join('\n');

            // Keep typing indicator active
            await message.channel.sendTyping().catch(console.error);

            // System prompt with memory instructions
            const systemPrompt = `You are Arjun, a friendly and casual productivity assistant. You speak in a relaxed, informal style using lowercase and minimal punctuation. Your goal is to help users stay productive and achieve their goals.

Context about this conversation:
I already have these memories saved about the user:
${memoriesContext}

Recent conversation history:
${conversationHistory}

Remember to maintain a casual, friendly tone and keep responses concise. Help the user stay productive but don't be pushy.

If you learn something NEW and important about the user that isn't already covered in the memories above, include a <MEMORY> tag in your response like this:
<MEMORY>Brief summary of what to remember about the user</MEMORY>

Only include a memory if it's truly useful for future interactions AND isn't redundant with existing memories. Most responses won't need a new memory.`;

            // Get response from Claude
            const response = await this.llmHandler.getResponse(message.content, systemPrompt);
            console.log(`Claude response received: ${response.slice(0, 100)}...`);

            // Extract and save memory before cleaning response
            const memoryMatch = response.match(/<MEMORY>[\s\S]*?<\/MEMORY>/g);
            if (memoryMatch) {
                // Handle each memory block
                for (const memoryBlock of memoryMatch) {
                    const memoryContent = memoryBlock.replace(/<\/?MEMORY>/g, '').trim();
                    await this.memoryHandler.addMemory(
                        message.author.id,
                        'conversation_summary',
                        memoryContent
                    );
                    console.log('Memory saved:', memoryContent);
                }
            }

            // Clean all memory tags from response
            const cleanResponse = response.replace(/<MEMORY>[\s\S]*?<\/MEMORY>/g, '').trim();

            // Send the cleaned response
            await message.reply(cleanResponse);
            console.log('Response sent to user');
        } catch (error) {
            console.error('Error handling DM:', error);
            console.error(error.stack);
            await message.reply("sorry, i'm having trouble processing that right now!").catch(console.error);
        }
    }

    async exportUserData(userId) {
        try {
            const data = {
                config: await this.getUserConfig(userId),
                messages: await this.getUserMessages(userId),
                memories: await this.memoryHandler.getMemories(userId)
            };
            
            // Create a temporary file
            const tempFilePath = path.join(__dirname, 'temp', `${userId}_data.json`);
            await fs.mkdir(path.dirname(tempFilePath), { recursive: true });
            await fs.writeFile(tempFilePath, JSON.stringify(data, null, 2));
            
            return tempFilePath;
        } catch (error) {
            console.error('Error exporting user data:', error);
            throw error;
        }
    }

    async ensureTempDirectory() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
        } catch (error) {
            console.error('Error creating temp directory:', error);
        }
    }

    async cleanupTempFiles() {
        try {
            const files = await fs.readdir(this.tempDir);
            await Promise.all(files.map(file => 
                fs.unlink(path.join(this.tempDir, file))
            ));
        } catch (error) {
            console.error('Error cleaning up temp files:', error);
        }
    }
}

// Start the bot
const bot = new ArjunBot();
bot.start(); 