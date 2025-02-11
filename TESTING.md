# Testing Guide for Arjun Bot

## Setup Testing
1. Run `/begin`
   - Expected: Bot should reply confirming setup and suggest using /config
   - Run again to test already-setup message

2. Run `/config`
   - Expected: Should show all your current settings
   - Default times should be:
     - Morning check: 9:00
     - Evening review: 21:00
     - Weekly review: Sunday at 18:00
     - Random check probability: 30%
     - Timezone: UTC

3. Run `/set_time`
   - Test morning_check with different hours (0-23)
   - Test evening_review with different hours (0-23)
   - Run `/config` after each change to verify updates

## Message Testing
Use these commands to test different message types:

1. `/test_morning`
   - Should receive a DM with one of these messages:
     - "hey, what are you planning to work on today?"
     - "what are you thinking of getting done today?"
     - "hey there, what's the plan for today?"

2. `/test_evening`
   - Should receive a DM with one of these messages:
     - "hey, how did your day go?"
     - "what did you end up working on today?"
     - "how was your day? what worked/didnt work?"
     - "lets review what you got done today"

3. `/test_activity`
   - Should receive a DM with one of these messages:
     - "what are you working on rn?"
     - "hey, hows the current task going?"
     - "quick check - what are you up to?"

4. `/test_weekly`
   - Should receive a DM with:
     - "hey, let's do our weekly review! how did this week go overall?"

## Automated Check Testing
To test the automated checks:

1. Set times close to current time:
   ```
   /set_time check_type:morning_check hour:<current_hour>
   /set_time check_type:evening_review hour:<current_hour>
   ```

2. Wait for the next minute (XX:00)
   - Should receive the corresponding check message

3. For activity checks:
   - These occur randomly between morning and evening times
   - 30% chance each minute during active hours
   - May need to wait several minutes to see one

## Error Testing
1. Try `/set_time` without starting first
   - Should get "you haven't started yet" message

2. Try `/config` without starting first
   - Should get "you haven't started yet" message

3. Try invalid commands
   - Should get error message directing to /help

## Data Persistence Testing
1. Make some configuration changes
2. Restart the bot
3. Run `/config`
   - Should see your saved settings

## Common Issues
- If slash commands don't appear:
  - Check console for registration errors
  - Reinvite bot with correct permissions
  - Wait a few minutes for Discord to update

- If DMs don't arrive:
  - Check if you have DMs enabled from server members
  - Check bot's error logs for DM permission issues 