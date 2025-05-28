# Priority
[] implement the new card and card ability tables into the battle manager logic
[] create sql dump file for card and card ability tables
[] have a way to transfer email appeals/tickets into the discord
[] clean up the new bot setup shtuff

# Here-and-There
[] maybe make it easier to set things up instead of having multiple different commands
[] make the console logging a lot better in case of unknown issues

# Back-Burner
[] i kinda wanna make a card game so to say
[] have a bot log system
[] maybe change the admin only replies just to make things look nicer (not a priority)
[] maybe make an archive for tickets that are made admin only?
[] maybe make a revert button for the admin only button?

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