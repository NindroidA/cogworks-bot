# Guild Lifecycle Testing Guide

This guide provides step-by-step instructions to test the multi-server guild join/leave flow and data isolation.

## Prerequisites

- Bot must be running in production mode
- Access to at least 2 test Discord servers
- Admin permissions in both servers
- Bot invite link ready

## Test 1: Guild Join Flow

### Steps:
1. **Invite bot to Server A**
   - Use bot invite link
   - Grant necessary permissions (Administrator for full testing)

2. **Verify welcome message**
   - [ ] Bot sends welcome embed in system channel or #general
   - [ ] Embed contains all sections (Features, Quick Start, Commands, Privacy, Help)
   - [ ] Footer shows correct server count
   - [ ] Links in embed are clickable

3. **Verify command registration**
   - [ ] Type `/` and verify commands appear
   - [ ] Try running `/bot-setup` (should work)
   - [ ] Commands are guild-specific (not global)

4. **Check logs**
   ```bash
   pm2 logs cogworks-bot --lines 50
   ```
   - [ ] "Joined new guild" message logged
   - [ ] "Registered commands for new guild" logged
   - [ ] "Sent welcome message" logged
   - [ ] No errors in logs

### Expected Results:
✅ Welcome message sent successfully
✅ All commands registered
✅ No errors in console
✅ Bot status shows correct server count

---

## Test 2: Bot Setup & Data Creation

### Server A Setup:
1. **Run `/bot-setup` in Server A**
   - [ ] Wizard starts successfully
   - [ ] Complete setup with custom values:
     - Staff role: `@Staff-A`
     - Ticket category: "Support-A"
     - Application category: "Applications-A"
     - Announcement channel: `#announcements-a`

2. **Create test data in Server A**
   - [ ] Create ticket using `/ticket-setup` → ticket button
   - [ ] Create application position: "Moderator-A"
   - [ ] Submit application for "Moderator-A"
   - [ ] Create bait channel: `#free-nitro-a`

3. **Verify data in Server A**
   - [ ] Ticket channel created
   - [ ] Application submitted and visible
   - [ ] Bait channel monitoring active

### Server B Setup:
1. **Invite bot to Server B**
   - [ ] Welcome message appears

2. **Run `/bot-setup` in Server B**
   - [ ] Wizard starts successfully
   - [ ] Complete setup with DIFFERENT values:
     - Staff role: `@Staff-B`
     - Ticket category: "Support-B"
     - Application category: "Applications-B"
     - Announcement channel: `#announcements-b`

3. **Create test data in Server B**
   - [ ] Create ticket using `/ticket-setup` → ticket button
   - [ ] Create application position: "Moderator-B"
   - [ ] Submit application for "Moderator-B"
   - [ ] Create bait channel: `#free-nitro-b`

### Expected Results:
✅ Both servers configured independently
✅ No interference between setups
✅ Different configs for each server

---

## Test 3: Data Isolation Verification

### Cross-Server Data Access Test:

1. **In Server A - Check tickets**
   - [ ] Only Server A tickets visible
   - [ ] Server B tickets NOT visible
   - [ ] Ticket count accurate for Server A only

2. **In Server B - Check tickets**
   - [ ] Only Server B tickets visible
   - [ ] Server A tickets NOT visible
   - [ ] Ticket count accurate for Server B only

3. **In Server A - Check applications**
   - [ ] Only "Moderator-A" position exists
   - [ ] "Moderator-B" position NOT visible
   - [ ] Applications only from Server A users

4. **In Server B - Check applications**
   - [ ] Only "Moderator-B" position exists
   - [ ] "Moderator-A" position NOT visible
   - [ ] Applications only from Server B users

5. **Database query verification** (optional - for developers)
   ```bash
   # SSH to production server
   # Check guild isolation in database
   mysql -u [user] -p [database]
   
   SELECT guildId, COUNT(*) FROM tickets GROUP BY guildId;
   SELECT guildId, COUNT(*) FROM applications GROUP BY guildId;
   SELECT guildId, COUNT(*) FROM positions GROUP BY guildId;
   ```
   - [ ] Each guildId has separate data counts
   - [ ] No NULL guildIds
   - [ ] Counts match expected values

### Expected Results:
✅ Server A sees ONLY Server A data
✅ Server B sees ONLY Server B data
✅ No cross-guild data leaks
✅ Database confirms guild isolation

---

## Test 4: Guild Leave & Data Deletion (GDPR)

⚠️ **CRITICAL TEST** - This permanently deletes data. Test on disposable servers only!

### Server A - Leave & Cleanup:

1. **Before leaving - Note data counts**
   - [ ] Count Server A tickets
   - [ ] Count Server A applications
   - [ ] Count Server A bait channel logs
   - [ ] Export data using `/data-export` (save for verification)

2. **Remove bot from Server A**
   - Server Settings → Apps → Cogworks Bot → Remove

3. **Check logs immediately**
   ```bash
   pm2 logs cogworks-bot --lines 100
   ```
   - [ ] "Left guild: [Server A name]" logged
   - [ ] "Starting GDPR-compliant data deletion" logged
   - [ ] "Successfully deleted X records across Y tables" logged
   - [ ] Deletion breakdown shows specific counts per table:
     - BotConfig: 1
     - TicketConfig: 1 (if configured)
     - Tickets: X (actual count)
     - ApplicationConfig: 1 (if configured)
     - Applications: X (actual count)
     - Positions: X (actual count)
     - BaitChannelConfig: 1 (if configured)
     - BaitChannelLog: X (actual count)
     - SavedRole: X (actual count)
   - [ ] No errors during deletion
   - [ ] "Bot now serving X servers" updated count

4. **Verify Server B unaffected**
   - [ ] Server B tickets still exist
   - [ ] Server B applications still exist
   - [ ] Server B bait channels still monitored
   - [ ] Server B bot config intact

5. **Re-invite bot to Server A**
   - [ ] Welcome message appears again
   - [ ] No old data visible
   - [ ] Bot behaves as if joining for first time
   - [ ] Must run `/bot-setup` again (no saved config)

### Expected Results:
✅ All Server A data deleted from database
✅ Deletion logged with accurate counts
✅ Server B completely unaffected
✅ Re-inviting bot creates fresh slate
✅ No orphaned data in database

---

## Test 5: Concurrent Operations

Test that multiple guilds can use the bot simultaneously without conflicts.

### Setup:
- Keep both Server A and Server B with bot installed
- Both servers should have active tickets, applications, etc.

### Concurrent Actions:
1. **At the same time in both servers:**
   - Server A: Create new ticket
   - Server B: Create new ticket
   - [ ] Both tickets created successfully
   - [ ] No race conditions or conflicts

2. **At the same time in both servers:**
   - Server A: Submit application
   - Server B: Submit application
   - [ ] Both applications submitted
   - [ ] No cross-contamination

3. **At the same time in both servers:**
   - Server A: Send message in bait channel
   - Server B: Send message in bait channel
   - [ ] Both users flagged independently
   - [ ] Correct guild-specific responses

4. **At the same time in both servers:**
   - Server A: Run `/data-export`
   - Server B: Run `/data-export`
   - [ ] Both exports contain correct guild-specific data
   - [ ] No data mixing

### Expected Results:
✅ No race conditions
✅ No database locks
✅ All operations complete successfully
✅ Data remains isolated

---

## Test 6: Error Handling

### Invalid Guild ID Test:
This tests internal error handling (requires code inspection, not user-facing).

**Developer check:**
- [ ] All database queries include `guildId` filter
- [ ] No queries can accidentally fetch cross-guild data
- [ ] Error handlers don't leak guild info

### Missing Bot Config Test:
1. **Remove bot from Server A** (fresh start)
2. **Re-invite bot to Server A**
3. **Try commands BEFORE running `/bot-setup`:**
   - [ ] `/ticket-setup` → Error: "Run /bot-setup first"
   - [ ] `/application-setup` → Error: "Run /bot-setup first"
   - [ ] `/announcement-setup` → Error: "Run /bot-setup first"
   - [ ] `/bot-setup` → Works (should be the only command that works)

### Expected Results:
✅ Commands gracefully handle missing config
✅ Helpful error messages guide users
✅ `/bot-setup` always works (creates config)

---

## Test 7: Scale Testing (Optional)

**If you have access to 5+ servers:**

1. **Invite bot to 5+ servers**
2. **Run `/bot-setup` in all servers with unique configs**
3. **Create test data in all servers**
4. **Verify:**
   - [ ] All servers have independent data
   - [ ] Performance remains stable
   - [ ] No memory leaks (check `pm2 monit`)
   - [ ] Logs show no errors

5. **Remove bot from 1 middle server**
   - [ ] Only that server's data deleted
   - [ ] All other servers unaffected

### Expected Results:
✅ Bot scales to multiple guilds
✅ Performance stable
✅ Data isolation maintained
✅ Deletion surgical (only target guild)

---

## Summary Checklist

### ✅ Guild Join
- [ ] Welcome message sent correctly
- [ ] Commands registered per guild
- [ ] Logs show successful join
- [ ] No errors

### ✅ Data Isolation
- [ ] Each guild sees only its own data
- [ ] No cross-guild data visibility
- [ ] Database properly guild-scoped
- [ ] Concurrent operations work

### ✅ Guild Leave (GDPR)
- [ ] All guild data deleted on leave
- [ ] Deletion logged with counts
- [ ] Other guilds unaffected
- [ ] Re-invite creates fresh start

### ✅ Error Handling
- [ ] Missing config handled gracefully
- [ ] Helpful error messages
- [ ] No crashes or hangs

---

## Known Issues / Notes

*Document any issues found during testing here:*

- 
- 
- 

---

## Test Completion

**Date Tested:** _______________
**Tested By:** _______________
**Version:** _______________
**Result:** ☐ PASS ☐ FAIL ☐ NEEDS REVIEW

**Notes:**

