# Priority
[] clean up announcement module (cause i just threw it together lickidy shplit)
[] add the minecraft role to the saved roles
[] add the announcement module setup to the bot setup
[] have a way to transfer email appeals/tickets into the discord
[] implement tickets onto a minecraft server (using a plugin)
[] add tags for the forms for the archiving functionality (to make it easier to look things up/sort on discord)

# Here-and-There
[] maybe make it easier to set things up instead of having multiple different commands
[] make the console logging a lot better in case of unknown issues
[] clean up the new bot setup shtuff

# Back-Burner
[] have a bot log system
[] maybe change the admin only replies just to make things look nicer (not a priority)
[] maybe make a revert button for the admin only button?
~~[] i kinda wanna make a card game so to say~~
~~[] implement the new card and card ability tables into the battle manager logic~~
~~[] create sql dump file for card and card ability tables~~

# Completed
[x] do the logic of getting each saved role (if any) and add them to the perms of ticket channels
[x] make command for ticket 'admin only' (removes everyone from being able to see the ticket except for ticket creator and admins)
[x] fix styling with admin only button and cancel button
[x] make sure staff and admins can also close the ticket (or make tickets admin only)
[x] make sure the bot knows when it's suppose to be in Development or Production mode
[x] Handle a better way to allow ticket creators to use the Admin Only button
[x] make more replies for bapples (like our shtuff)
[x] fix slash commands only showing up on one server
[x] deprecate the env variable GUILD_ID
[x] make sure the ticket creator can send images into tickets
[x] make a config option for a global staff role
[x] when a player report ticket is made, @ the global staff role
[x] actually get the custom status working lol
[x] do some type shite for slash commands where we yoink the guilds that have done the bot setup command (from bot config) and use guild commands, otherwise stick to application commands
[x] fix up the whole command registering (in an event like adding a new bot config)
[x] start announcement module