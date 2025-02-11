import discord
from discord.ext import tasks
import json
import datetime
import random
from typing import Dict
from dotenv import load_dotenv
import os
from llm_handler import LLMHandler
from clockify_handler import ClockifyHandler

# Load environment variables
load_dotenv()

# Bot configuration
DISCORD_TOKEN = os.getenv('DISCORD_TOKEN')

if not DISCORD_TOKEN:
    raise ValueError("No Discord token found in .env file")


class ArjunBot(discord.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True
        intents.dm_messages = True
        super().__init__(intents=intents)
        
        # No need for command tree with Pycord
        # self.tree = app_commands.CommandTree(self)
        
        # Initialize data storage and LLM handler
        self.user_data: Dict = self.load_data()
        self.llm_handler = LLMHandler()
        self.clockify_handler = None
        
        # Default configuration values
        self.default_config = {
            "morning_check_hour": 9,
            "evening_review_hour": 21,
            "weekly_review_day": "SUNDAY",  # Can be MON, TUE, WED, THU, FRI, SAT, SUN
            "weekly_review_hour": 18,
            "activity_check_interval": 30,  # minutes
            "activity_check_probability": 0.3,
            "timezone": "UTC",
            "clockify_api_key": None,
            "clockify_enabled": False
        }
        
        # Messages in Arjun's style - casual, direct, lowercase
        self.morning_messages = [
            "hey, what are you planning to work on today?",
            "what are you thinking of getting done today?",
            "hey there, what's the plan for today?"
        ]
        
        self.evening_messages = [
            "hey, how did your day go?",
            "what did you end up working on today?",
            "how was your day? what worked/didnt work?",
            "lets review what you got done today"
        ]
        
        self.activity_check_messages = [
            "what are you working on rn?",
            "hey, hows the current task going?",
            "quick check - what are you up to?"
        ]
        
        # Configure task intervals
        self.morning_check.change_interval(minutes=1)
        self.evening_review.change_interval(minutes=1)
        self.activity_check.change_interval(minutes=1)
        self.weekly_review_check.change_interval(minutes=1)

    async def setup_hook(self):
        # Register slash commands
        print("Registering slash commands...")
        try:
            # Sync commands globally only
            await self.tree.sync()
            print("Synced commands globally")
            
            # Print out registered commands
            commands = self.tree.get_commands()
            print(f"Registered {len(commands)} commands:")
            for cmd in commands:
                print(f"- /{cmd.name}")
        except Exception as e:
            print(f"Error syncing commands: {e}")
        
        # Start tasks
        self.morning_check.start()
        self.evening_review.start()
        self.activity_check.start()
        self.weekly_review_check.start()
        print("Started all tasks")

    @discord.Cog.listener()
    async def on_ready(self):
        print(f"Logged in as {self.user} (ID: {self.user.id})")
        print(f"Connected to {len(self.guilds)} guilds:")
        for guild in self.guilds:
            print(f"- {guild.name} (ID: {guild.id})")
        print("------")

    def add_user(self, user_id: int) -> None:
        """Add a new user to tracking if they don't exist"""
        if str(user_id) not in self.user_data:
            self.user_data[str(user_id)] = {
                "joined_date": datetime.datetime.now().isoformat(),
                "weekly_plans": [],
                "daily_logs": [],
                "last_interaction": None,
                "last_activity_check": None,  # Add tracking for last activity check
                "config": self.default_config.copy()
            }
            self.save_data()
            print(f"Added new user: {user_id}")

    @tasks.loop(minutes=1)
    async def morning_check(self):
        """Send morning planning message to all tracked users based on their timezone"""
        for user_id, user_data in self.user_data.items():
            try:
                config = user_data.get("config", self.default_config)
                user_tz = datetime.timezone(config["timezone"])
                user_time = datetime.datetime.now(user_tz)
                
                # Check if it's the configured morning check hour
                if (user_time.hour == config["morning_check_hour"] and 
                    user_time.minute == 0):
                    user = await self.fetch_user(int(user_id))
                    await user.send(random.choice(self.morning_messages))
            except discord.NotFound:
                print(f"Could not find user {user_id}")
            except Exception as e:
                print(f"Error in morning check for user {user_id}: {e}")

    @tasks.loop(minutes=1)
    async def evening_review(self):
        """Send evening review message to all tracked users based on their timezone"""
        for user_id, user_data in self.user_data.items():
            try:
                config = user_data.get("config", self.default_config)
                user_tz = datetime.timezone(config["timezone"])
                user_time = datetime.datetime.now(user_tz)
                
                # Check if it's the configured evening review hour
                if (user_time.hour == config["evening_review_hour"] and 
                    user_time.minute == 0):
                    user = await self.fetch_user(int(user_id))
                    await user.send(random.choice(self.evening_messages))
            except discord.NotFound:
                print(f"Could not find user {user_id}")
            except Exception as e:
                print(f"Error in evening review for user {user_id}: {e}")

    @tasks.loop(minutes=1)
    async def activity_check(self):
        """Check status based on user-specific intervals and probabilities"""
        for user_id, user_data in self.user_data.items():
            try:
                config = user_data.get("config", self.default_config)
                last_check = user_data.get("last_activity_check")
                
                # Convert last check to datetime if it exists
                if last_check:
                    last_check = datetime.datetime.fromisoformat(last_check)
                
                current_time = datetime.datetime.now(datetime.timezone.utc)
                
                # Check if enough time has passed since last check
                if (not last_check or 
                    (current_time - last_check).total_seconds() >= config["activity_check_interval"] * 60):
                    
                    # Apply user-specific probability
                    if random.random() < config["activity_check_probability"]:
                        user = await self.fetch_user(int(user_id))
                        await user.send(random.choice(self.activity_check_messages))
                    
                    # Update last check time
                    self.user_data[user_id]["last_activity_check"] = current_time.isoformat()
                    self.save_data()
                    
            except discord.NotFound:
                print(f"Could not find user {user_id}")
            except Exception as e:
                print(f"Error in activity check for user {user_id}: {e}")

    @tasks.loop(minutes=1)
    async def weekly_review_check(self):
        """Check for weekly review times"""
        for user_id, user_data in self.user_data.items():
            try:
                config = user_data.get("config", self.default_config)
                user_tz = datetime.timezone(config["timezone"])
                user_time = datetime.datetime.now(user_tz)
                
                # Map day names to weekday numbers (0 = Monday)
                day_map = {
                    "MON": 0, "TUE": 1, "WED": 2, "THU": 3,
                    "FRI": 4, "SAT": 5, "SUN": 6
                }
                
                # Check if it's the configured weekly review day and hour
                if (user_time.weekday() == day_map[config["weekly_review_day"]] and
                    user_time.hour == config["weekly_review_hour"] and
                    user_time.minute == 0):
                    user = await self.fetch_user(int(user_id))
                    await user.send("Time for our weekly review! How did your week go?")
            except discord.NotFound:
                print(f"Could not find user {user_id}")
            except Exception as e:
                print(f"Error in weekly review check for user {user_id}: {e}")

    def load_data(self) -> Dict:
        try:
            with open('user_data.json', 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            return {}
            
    def save_data(self):
        with open('user_data.json', 'w') as f:
            json.dump(self.user_data, f, indent=4)

    @discord.slash_command(
        name="begin",
        description="start tracking your productivity"
    )
    async def begin_tracking(self, ctx: discord.ApplicationContext):
        try:
            user_id = ctx.author.id
            if str(user_id) in self.user_data:
                await ctx.respond(
                    "hey, we're already connected! use `/help` to see what i can do",
                    ephemeral=True
                )
                return
                
            self.add_user(user_id)
            await ctx.respond(
                "hey! im arjun, and ill help you stay productive\n\n"
                "here's what we'll do:\n"
                "• chat about your plans in the morning\n"
                "• check in sometimes to see how things are going\n"
                "• reflect on what you got done in the evening\n\n"
                "type `/help` to see all the commands\n"
            )
        except Exception as e:
            print(f"Error in begin command: {e}")
            await ctx.respond(
                "sorry, something went wrong. please try again later",
                ephemeral=True
            )

    @discord.slash_command(
        name="config",
        description="see your current settings"
    )
    async def config(self, ctx: discord.ApplicationContext):
        user_id = str(ctx.author.id)
        if user_id not in self.user_data:
            await ctx.respond("use `/begin` to begin tracking first!")
            return

        config = self.user_data[user_id].get("config", self.default_config)
        config_text = (
            "current settings:\n\n"
            f"morning check: {config['morning_check_hour']}:00 {config['timezone']}\n"
            f"evening review: {config['evening_review_hour']}:00 {config['timezone']}\n"
            f"weekly review: {config['weekly_review_day']} {config['weekly_review_hour']}:00 {config['timezone']}\n"
            f"activity check interval: {config['activity_check_interval']} minutes\n"
            f"activity check probability: {config['activity_check_probability'] * 100}%\n"
        )

        if config.get('clockify_enabled'):
            config_text += "\nclockify: enabled"
        else:
            config_text += "\nclockify: disabled"

        config_text += (
            "\n\nto change settings:\n"
            "`/set_time TYPE HOUR` - change when i check in (morning_check/evening_review)\n"
            "`/set_weekly_review DAY HH` - set weekly review day and hour (e.g., 'MON 18')\n"
            "`/set_activity_check MINS PROB` - set activity check interval (mins) and probability (0-1)\n"
            "`/set_timezone TIMEZONE` - set timezone (e.g., 'UTC', 'US/Pacific')\n"
            "`/set_clockify API_KEY` - connect clockify\n"
            "`/disable_clockify` - turn off clockify"
        )
        
        await ctx.respond(config_text)

    @discord.slash_command(
        name="set_time",
        description="change when i check in with you"
    )
    async def set_time(
        self, 
        ctx: discord.ApplicationContext,
        check_type: str = discord.Option(
            description="Type of check",
            choices=["morning_check", "evening_review"]
        ),
        hour: int = discord.Option(
            description="Hour in 24-hour format",
            min_value=0,
            max_value=23
        )
    ):
        user_id = str(ctx.author.id)
        if user_id not in self.user_data:
            await ctx.respond("use `/begin` to begin tracking first!")
            return

        if hour < 0 or hour > 23:
            await ctx.respond("Please provide a valid hour (0-23)!")
            return

        if check_type not in ["morning_check", "evening_review"]:
            await ctx.respond("Please specify either 'morning_check' or 'evening_review'!")
            return

        config_key = f"{check_type}_hour"
        self.user_data[user_id]["config"][config_key] = hour
        self.save_data()
        
        await ctx.respond(f"Updated {check_type} time to {hour}:00 {self.user_data[user_id]['config']['timezone']}")

    @discord.slash_command(
        name="set_weekly_review",
        description="set when to do weekly reviews"
    )
    async def set_weekly_review(
        self, 
        ctx: discord.ApplicationContext,
        day: str = discord.Option(
            description="Day of the week",
            choices=["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
        ),
        hour: int = discord.Option(
            description="Hour in 24-hour format",
            min_value=0,
            max_value=23
        )
    ):
        user_id = str(ctx.author.id)
        if user_id not in self.user_data:
            await ctx.respond("use `/begin` to begin tracking first!")
            return

        self.user_data[user_id]["config"]["weekly_review_day"] = day
        self.user_data[user_id]["config"]["weekly_review_hour"] = hour
        self.save_data()
        
        await ctx.respond(f"Updated weekly review to {day} {hour}:00 {self.user_data[user_id]['config']['timezone']}")

    @discord.slash_command(
        name="set_activity_check",
        description="change how often i check what you're doing"
    )
    async def set_activity_check(
        self, 
        ctx: discord.ApplicationContext,
        interval: int = discord.Option(
            description="Interval in minutes",
            min_value=15,
            max_value=240
        ),
        probability: float = discord.Option(
            description="Probability of checking",
            min_value=0.0,
            max_value=1.0
        )
    ):
        user_id = str(ctx.author.id)
        if user_id not in self.user_data:
            await ctx.respond("use `/begin` to begin tracking first!")
            return

        self.user_data[user_id]["config"]["activity_check_interval"] = interval
        self.user_data[user_id]["config"]["activity_check_probability"] = probability
        self.save_data()
        
        await ctx.respond(f"Updated activity check: {interval} minute intervals with {probability * 100}% probability")

    @discord.slash_command(
        name="set_timezone",
        description="set your timezone"
    )
    async def set_timezone(
        self, 
        ctx: discord.ApplicationContext,
        timezone: str = discord.Option(
            description="Timezone identifier (e.g., 'UTC', 'US/Pacific')"
        )
    ):
        user_id = str(ctx.author.id)
        if user_id not in self.user_data:
            await ctx.respond("use `/begin` to begin tracking first!")
            return

        try:
            datetime.datetime.now(datetime.timezone.utc).astimezone(datetime.timezone(timezone))
            self.user_data[user_id]["config"]["timezone"] = timezone
            self.save_data()
            await ctx.respond(f"Updated timezone to {timezone}")
        except Exception as e:
            await ctx.respond(f"Invalid timezone. Please use a valid timezone identifier (e.g., 'UTC', 'US/Pacific')")

    @discord.slash_command(
        name="set_clockify",
        description="connect your clockify account"
    )
    async def set_clockify(
        self, 
        interaction: discord.Interaction,
        api_key: commands.Option(str, "Clockify API key")
    ):
        user_id = str(interaction.user.id)
        if user_id not in self.user_data:
            await interaction.response.send_message("Please use `/begin` to begin tracking first!")
            return

        # Initialize handler to test connection
        handler = ClockifyHandler(api_key)
        if handler.setup():
            self.user_data[user_id]["config"]["clockify_api_key"] = api_key
            self.user_data[user_id]["config"]["clockify_enabled"] = True
            self.save_data()
            await interaction.response.send_message("Clockify integration enabled successfully!")
        else:
            await interaction.response.send_message("Failed to connect to Clockify. Please check your API key.")

    @discord.slash_command(
        name="disable_clockify",
        description="turn off clockify integration"
    )
    async def disable_clockify(self, interaction: discord.Interaction):
        user_id = str(interaction.user.id)
        if user_id not in self.user_data:
            await interaction.response.send_message("Please use `/begin` to begin tracking first!")
            return

        self.user_data[user_id]["config"]["clockify_enabled"] = False
        self.save_data()
        await interaction.response.send_message("Clockify integration disabled.")

    @discord.slash_command(
        name="help",
        description="get info about what i can do"
    )
    async def help(self, interaction: discord.Interaction):
        help_text = (
            "hey! here's what i can help with:\n\n"
            "**getting started**\n"
            "`/begin` - start tracking your productivity\n"
            "`/stop` - pause our check-ins\n\n"
            "**daily planning**\n"
            "`/config` - see your current settings\n"
            "`/set_time` - change when i check in\n"
            "`/set_activity_check` - how often i check what you're up to\n"
            "`/set_timezone` - set your timezone\n\n"
            "**weekly stuff**\n"
            "`/upload_plan` - share what you want to do this week\n"
            "`/review` - look back at how the week went\n"
            "`/set_weekly_review` - when to do weekly reviews\n\n"
            "**time tracking**\n"
            "`/set_clockify` - connect your clockify account\n"
            "`/disable_clockify` - turn off clockify integration\n\n"
            "i'll also:\n"
            "• check in each morning about your plans\n"
            "• see how you're doing throughout the day\n"
            "• help review what you got done in the evening\n\n"
            "just message me anytime if you want to chat about your work"
        )
        await interaction.response.send_message(help_text)

    @discord.slash_command(
        name="stop",
        description="pause our check-ins"
    )
    async def stop(self, interaction: discord.Interaction):
        user_id = str(interaction.user.id)
        if user_id in self.user_data:
            del self.user_data[user_id]
            self.save_data()
            await interaction.response.send_message(
                "alr, taking a break\n"
                "use `/begin` whenever you want to start again\n"
                "see you around!"
            )
        else:
            await interaction.response.send_message("we haven't started yet! use `/begin` to begin")

    async def process_evening_review_response(self, message):
        """Process evening review response and generate report"""
        user_id = str(message.author.id)
        response = await self.llm_handler.process_evening_review(
            message.content,
            self.user_data[user_id]
        )

        # Add Clockify report if enabled
        config = self.user_data[user_id].get("config", {})
        if config.get("clockify_enabled") and config.get("clockify_api_key"):
            handler = ClockifyHandler(config["clockify_api_key"])
            if handler.setup():
                # Get today's entries
                start_date = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                end_date = start_date + datetime.timedelta(days=1)
                entries = handler.get_time_entries(start_date, end_date)
                report = handler.generate_daily_report(entries)
                response += f"\n\n{report}"

        return response

    async def process_weekly_review_response(self, message):
        """Process weekly review response and generate report"""
        user_id = str(message.author.id)
        response = await self.llm_handler.process_weekly_review(
            message.content,
            self.user_data[user_id]
        )

        # Add Clockify report if enabled
        config = self.user_data[user_id].get("config", {})
        if config.get("clockify_enabled") and config.get("clockify_api_key"):
            handler = ClockifyHandler(config["clockify_api_key"])
            if handler.setup():
                # Get this week's entries
                end_date = datetime.datetime.now().replace(hour=23, minute=59, second=59)
                start_date = end_date - datetime.timedelta(days=7)
                entries = handler.get_time_entries(start_date, end_date)
                report = handler.generate_weekly_report(entries)
                response += f"\n\n{report}"

        return response

    @discord.Cog.listener()
    async def on_message(self, message):
        if message.author == self.user:
            return
            
        # Handle DM responses
        if isinstance(message.channel, discord.DMChannel):
            # Only process DMs if user is being tracked
            user_id = str(message.author.id)
            if user_id in self.user_data:
                self.user_data[user_id]["last_interaction"] = datetime.datetime.now().isoformat()
                
                # Process message through LLM
                response = await self.process_evening_review_response(message)
                
                if response:
                    # Check if there are any memory updates
                    if "MEMORY_UPDATE:" in response:
                        memory_update_start = response.find("MEMORY_UPDATE:")
                        memory_update_end = response.find("}", memory_update_start) + 1
                        memory_update = response[memory_update_start:memory_update_end]
                        # Remove the memory update from the response
                        response = response.replace(memory_update, "").strip()
                        # TODO: Process memory update
                    
                    # Check if conversation should end
                    end_conversation = False
                    if "END_CONVERSATION: true" in response:
                        end_conversation = True
                        # Remove the end conversation marker from the response
                        response = response.replace("END_CONVERSATION: true", "").strip()
                    elif "END_CONVERSATION: false" in response:
                        response = response.replace("END_CONVERSATION: false", "").strip()
                    
                    await message.channel.send(response)
                
                self.save_data()

    @discord.Cog.listener()
    async def on_application_command_error(
        self,
        interaction: discord.Interaction,
        error: discord.DiscordException
    ):
        """Handle slash command errors"""
        print(f"Command error: {error}")
        await interaction.response.send_message(
            "sorry, something went wrong with that command. please try again later",
            ephemeral=True
        )

if __name__ == "__main__":
    bot = ArjunBot()
    try:
        bot.run(DISCORD_TOKEN)
    except Exception as e:
        print(f"Error running bot: {e}")
