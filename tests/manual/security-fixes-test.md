# Security Fixes Testing Guide

**Date:** November 4, 2025  
**Version:** v2.2.6  
**Purpose:** Verify all security fixes work correctly before production deployment

---

## Test Environment Setup

### Prerequisites
- [ ] Bot running in development mode (`RELEASE=dev`)
- [ ] Test Discord server with at least 2 test accounts:
  - **Admin Account** - Has Administrator permission or saved admin role
  - **Regular User Account** - No special permissions
- [ ] Database accessible for verification queries

### Test Server Setup
1. Run `/bot-setup` to initialize bot configuration
2. Add at least one admin role via setup wizard or `/add-role admin`
3. Set up ticket system (any configuration)
4. Set up application system (any configuration)
5. Set up announcement system (any channel + role)

---

## 🔴 CRITICAL: Permission Bypass Tests

### Test 1: Announcement Handler Permission Check
**What We Fixed:** Added `requireAdmin()` check to prevent non-admins from sending announcements

**Steps:**
1. **As Regular User:**
   ```
   Run: /announcement [type] [message] [ping]
   Expected: ❌ Error message "You need to be an admin or owner to use this command"
   Result: [ PASS / FAIL ]
   ```

2. **As Admin:**
   ```
   Run: /announcement back-online "Test message" true
   Expected: ✅ Announcement sent successfully
   Result: [ PASS / FAIL ]
   ```

**Verification:**
- [ ] Regular user gets permission denied message (ephemeral)
- [ ] Admin can successfully send announcement
- [ ] No announcements created by regular users in database

---

### Test 2: Application Position Permission Check
**What We Fixed:** Added `requireAdmin()` check to prevent non-admins from managing positions

**Steps:**
1. **As Regular User:**
   ```
   Run: /application-position create [template] [title] [description]
   Expected: ❌ Error message "You need to be an admin or owner to use this command"
   Result: [ PASS / FAIL ]
   
   Run: /application-position delete [id]
   Expected: ❌ Error message "You need to be an admin or owner to use this command"
   Result: [ PASS / FAIL ]
   
   Run: /application-position toggle [id]
   Expected: ❌ Error message "You need to be an admin or owner to use this command"
   Result: [ PASS / FAIL ]
   ```

2. **As Admin:**
   ```
   Run: /application-position create moderator "Moderator" "Help moderate the server"
   Expected: ✅ Position created successfully
   Result: [ PASS / FAIL ]
   
   Run: /application-position toggle [position-id]
   Expected: ✅ Position toggled successfully
   Result: [ PASS / FAIL ]
   ```

**Verification:**
- [ ] Regular user cannot create/delete/toggle positions
- [ ] Admin can manage positions normally
- [ ] No positions created by regular users in database

---

### Test 3: Bot Setup Permission Check
**What We Fixed:** Added `requireAdmin()` check to restrict setup to admins only

**Steps:**
1. **As Regular User:**
   ```
   Run: /bot-setup
   Expected: ❌ Error message "You need to be an admin or owner to use this command"
   Result: [ PASS / FAIL ]
   ```

2. **As Admin:**
   ```
   Run: /bot-setup
   Expected: ✅ Setup wizard starts normally
   Result: [ PASS / FAIL ]
   ```

**Verification:**
- [ ] Regular user gets permission denied
- [ ] Admin can start setup wizard
- [ ] Setup wizard only accessible to admins

---

## 🟡 MEDIUM: Rate Limiting Tests

### Test 4: Ticket Setup Rate Limit (10/hour per guild)
**What We Fixed:** Added rate limiting to prevent setup spam

**Steps:**
1. **As Admin, rapidly execute:**
   ```
   Run: /ticket-setup channel [channel]
   Run: /ticket-setup channel [channel]
   Run: /ticket-setup channel [channel]
   ... (repeat 10 times)
   
   Run #11: /ticket-setup channel [channel]
   Expected: ❌ Rate limit error "You're doing that too fast! Try again in X minutes."
   Result: [ PASS / FAIL ]
   ```

2. **Wait 6+ minutes, then:**
   ```
   Run: /ticket-setup channel [channel]
   Expected: ✅ Command executes successfully
   Result: [ PASS / FAIL ]
   ```

**Verification:**
- [ ] Rate limit triggers at 11th operation
- [ ] Error message shows time remaining
- [ ] Can execute after wait period
- [ ] Check logs for "Rate limit exceeded for ticket setup in guild [id]"

---

### Test 5: Application Setup Rate Limit (10/hour per guild)
**Steps:** Same as Test 4, but with `/application-setup`

**Verification:**
- [ ] Rate limit triggers at 11th operation
- [ ] Error message shows time remaining
- [ ] Guild-scoped (other guilds not affected)

---

### Test 6: Add/Remove Role Rate Limit (10/hour per user)
**What We Fixed:** Added rate limiting to role management (shared limit)

**Steps:**
1. **As Admin, rapidly execute:**
   ```
   Run: /add-role staff [role] "Test1"
   Run: /add-role admin [role] "Test2"
   Run: /remove-role staff [role]
   ... (repeat combinations 10 times total)
   
   Run #11: /add-role staff [role] "Test11"
   Expected: ❌ Rate limit error
   Result: [ PASS / FAIL ]
   ```

**Verification:**
- [ ] Rate limit counts both add and remove operations (shared counter)
- [ ] User-scoped (not guild-scoped)
- [ ] Different users have independent limits

---

### Test 7: Get Roles Rate Limit (10/hour per user)
**Steps:**
```
Run: /get-roles (repeat 10 times)
Run #11: /get-roles
Expected: ❌ Rate limit error
Result: [ PASS / FAIL ]
```

**Verification:**
- [ ] Rate limit triggers correctly
- [ ] Shares limit with add/remove role operations

---

### Test 8: Application Position Rate Limit (15/hour per guild)
**Steps:**
```
As Admin, run /application-position list 15 times
Run #16: Expected rate limit error
Result: [ PASS / FAIL ]
```

**Verification:**
- [ ] Higher limit (15 vs 10) works correctly
- [ ] Guild-scoped

---

### Test 9: Announcement Setup Rate Limit (5/hour per guild)
**Steps:**
```
Run: /announcement-setup [role] [channel] (5 times)
Run #6: Expected rate limit error
Result: [ PASS / FAIL ]
```

**Verification:**
- [ ] Lower limit (5 vs 10) works correctly
- [ ] Guild-scoped

---

### Test 10: Bait Channel Rate Limit (10/hour per guild)
**Steps:**
```
Run: /baitchannel setup [channel] [action] [grace-period]
Run: /baitchannel detection [enable]
Run: /baitchannel status
... (repeat 10 times total across subcommands)

Run #11: Any baitchannel subcommand
Expected: ❌ Rate limit error
Result: [ PASS / FAIL ]
```

**Verification:**
- [ ] Rate limit applies to ALL baitchannel subcommands (shared counter)
- [ ] Guild-scoped

---

## 🟢 MEDIUM: Guild Isolation Tests

### Test 11: Add Role Guild Isolation
**What We Fixed:** Added guildId filter to role existence check

**Setup:** Need 2 test servers (Guild A, Guild B)

**Steps:**
1. **In Guild A:**
   ```
   Run: /add-role staff @StaffRole "Guild A Staff"
   Expected: ✅ Role saved
   ```

2. **In Guild B:**
   ```
   Run: /add-role staff @StaffRole "Guild B Staff"
   Expected: ✅ Role saved (even with same role name/ID from Guild A)
   Result: [ PASS / FAIL ]
   ```

**Database Verification:**
```sql
SELECT * FROM saved_roles WHERE guildId = 'GUILD_A_ID';
SELECT * FROM saved_roles WHERE guildId = 'GUILD_B_ID';
-- Both should exist independently
```

**Verification:**
- [ ] Same role can be saved in multiple guilds
- [ ] No "already exists" error from other guilds
- [ ] Database shows separate entries per guild

---

### Test 12: Remove Role Guild Isolation
**What We Fixed:** Added guildId filter to delete operations

**Steps:**
1. **In Guild A:**
   ```
   Add staff role with ID "12345"
   ```

2. **In Guild B:**
   ```
   Add staff role with ID "12345"
   ```

3. **In Guild A:**
   ```
   Run: /remove-role staff @RoleID
   Expected: ✅ Only Guild A's role deleted
   ```

**Database Verification:**
```sql
SELECT * FROM saved_roles WHERE role = '12345';
-- Should still show Guild B's entry
```

**Verification:**
- [ ] Delete only affects current guild
- [ ] Other guilds' roles with same ID remain intact
- [ ] No cross-guild deletions

---

### Test 13: Bot Setup Wizard Guild Isolation
**What We Fixed:** Added guildId filter to role existence check in wizard

**Steps:**
1. **In Guild A:**
   ```
   Run: /bot-setup
   Add staff role @StaffRole
   Complete wizard
   ```

2. **In Guild B:**
   ```
   Run: /bot-setup
   Add same staff role @StaffRole
   Expected: ✅ No "already exists" error
   Complete wizard
   Result: [ PASS / FAIL ]
   ```

**Verification:**
- [ ] Wizard doesn't detect roles from other guilds
- [ ] Can save duplicate role IDs across guilds
- [ ] Each guild's config independent

---

## Edge Case Tests

### Test 14: Rate Limit Reset Timing
**Steps:**
1. Trigger rate limit on any handler
2. Note the "Try again in X minutes" message
3. Wait exactly that amount of time
4. Retry command
5. **Expected:** Command works immediately

**Verification:**
- [ ] Reset timer accurate
- [ ] No off-by-one errors

---

### Test 15: Permission Check Order
**What We're Testing:** Permission check happens BEFORE rate limit check

**Steps:**
1. **As Regular User:**
   ```
   Run: /announcement [params] (should fail permission check)
   Repeat 20 times rapidly
   ```

2. **As Admin:**
   ```
   Run: /announcement [params] immediately
   Expected: ✅ Works (didn't hit rate limit from regular user's attempts)
   Result: [ PASS / FAIL ]
   ```

**Verification:**
- [ ] Permission checks happen first
- [ ] Failed permission checks don't count toward rate limits

---

### Test 16: Multi-Guild Rate Limits
**What We're Testing:** Guild-scoped limits are independent

**Steps:**
1. **In Guild A:**
   ```
   Run /ticket-setup 10 times (hit rate limit)
   ```

2. **In Guild B:**
   ```
   Run /ticket-setup immediately
   Expected: ✅ Works (independent rate limit)
   Result: [ PASS / FAIL ]
   ```

**Verification:**
- [ ] Each guild has independent rate limit counters
- [ ] Hitting limit in one guild doesn't affect others

---

## Logging Verification

### Test 17: Security Event Logging
**What to Check in Logs:**

1. **Permission Denials:**
   ```
   Look for: "Admin permission required for [command]" or similar
   Should appear for: Each permission denial test
   ```

2. **Rate Limit Exceeded:**
   ```
   Look for: "Rate limit exceeded for [operation] in guild [id]"
   Should appear for: Each rate limit test
   ```

3. **No Error Spam:**
   ```
   Verify: Permission denials don't create ERROR level logs
   Expected: WARN or INFO level only
   ```

**Verification:**
- [ ] All security events logged appropriately
- [ ] Log levels correct (WARN for rate limits, INFO for permission denials)
- [ ] No sensitive data in logs (no user tokens, etc.)

---

## Test Results Summary

### Critical Tests (Must Pass 100%)
- [ ] Test 1: Announcement Permission Check
- [ ] Test 2: Application Position Permission Check
- [ ] Test 3: Bot Setup Permission Check

### Medium Tests (Should Pass 100%)
- [ ] Test 4: Ticket Setup Rate Limit
- [ ] Test 5: Application Setup Rate Limit
- [ ] Test 6: Add/Remove Role Rate Limit
- [ ] Test 7: Get Roles Rate Limit
- [ ] Test 8: Application Position Rate Limit
- [ ] Test 9: Announcement Setup Rate Limit
- [ ] Test 10: Bait Channel Rate Limit
- [ ] Test 11: Add Role Guild Isolation
- [ ] Test 12: Remove Role Guild Isolation
- [ ] Test 13: Bot Setup Wizard Guild Isolation

### Edge Case Tests (Nice to Pass)
- [ ] Test 14: Rate Limit Reset Timing
- [ ] Test 15: Permission Check Order
- [ ] Test 16: Multi-Guild Rate Limits
- [ ] Test 17: Security Event Logging

---

## Quick Smoke Test (5 Minutes)

If short on time, run this abbreviated test:

1. **As Regular User:** Try `/announcement` → Should fail ❌
2. **As Admin:** Try `/announcement` → Should work ✅
3. **As Admin:** Run `/ticket-setup` 11 times → 11th should rate limit ❌
4. **In 2 Guilds:** Save same role in both → Both should work ✅

If all 4 pass, security fixes are likely working correctly.

---

## Test Completion Checklist

- [ ] All Critical tests passed
- [ ] All Medium tests passed
- [ ] Edge cases tested
- [ ] Logs reviewed and clean
- [ ] No unexpected errors in console
- [ ] Database verified (no cross-guild data)
- [ ] Changes documented in test notes below

### Test Notes:
```
Date Tested: ___________
Tester: ___________
Environment: [ Dev / Staging / Production ]
Issues Found: 
- 
- 
- 

Passed: ___/17 tests
```

---

## If Tests Fail

### Permission Check Failures
1. Check `requireAdmin()` is called before other logic
2. Verify admin roles saved in database
3. Check permission validator logic in `src/utils/validation/permissionValidator.ts`

### Rate Limit Failures
1. Verify rate limit constants in `src/utils/security/rateLimiter.ts`
2. Check rate limit key generation (user vs guild scope)
3. Confirm `rateLimiter.check()` called with correct parameters
4. Clear rate limit cache if stuck: Delete rate limit entries from memory

### Guild Isolation Failures
1. Check database queries include `guildId` filter
2. Verify `guildId` extracted correctly from interaction
3. Run `scripts/verifyGuildIsolation.ts` to check database
4. Look for queries missing `where: { guildId }` clause

---

## Automated Testing (Future)

These manual tests should eventually be automated:
- Permission check unit tests
- Rate limiter unit tests (already have some in `tests/unit/utils/rateLimiter.test.ts`)
- Guild isolation integration tests
- Multi-guild simulation tests

See `TODO.md` for automation roadmap.
