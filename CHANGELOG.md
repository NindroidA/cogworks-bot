# Dev Update v1.2.3
- Fixed bot-setup rollCollector/buttonCollector not technically stopping (just end up showing the timeout message)
- Cleaned up a few lang shtuff to make it nicer

# Dev Update v1.2.2
- Just fixed a lil oopsie :3

# Dev Update v1.2.1
- Ticket creator and staff can send reactions, emojis, and attachments in tickets
- Added command `/bot-setup` that allows for some initial configuration. 
- If the bot setup has not been ran, no other commands are usable.
- Added Global Staff Role which can be configured in the bot setup.
- When a player report ticket is made, if the Global Staff Role is enabled and set, then that role will be mentioned in the main message of the ticket.
- Added custom presense

# Dev Update v1.1.3
- Deprecated env variable GUILD_ID since it isn't necessary now

# Dev Update v1.1.2
- Made it so when the ticket creator presses the Admin Only button, instead of running the logic it will send a request so that a staff member can do it.
- Fixed slash commands only showing up on set discord server

# Dev Update v1.1.1
- Added logic for determining if we're using the Production bot or the Development bot
- Added more console logging
- Fixed small lang issue with the `/get-roles` command

# Dev Update v1.1.0
- First 'Beta' version! (I'm putting this on a larger server)
- I also made a dev bot so I do mess anything with the main bot.
- Fixed tickets so anyone that can view the ticket can close/admin only it (since the logic to make sure only specific roles see tickets is in place)

# Dev Update v1.0.3
- Utility function for extracting role ids from the database
- Added 'Admin Only' button next to ticket close button
- Changing a bunch of files to use the lang json
- Added 'Ticket Category' to ticket config database
- Added ticket category adding command
- Made sure logic was fixed for previous ticket category method to current
- Fixed styling with the Admin Only and Close Ticket buttons

# Dev Update v1.0.2
- Changelog finally lol
- Adding admin/staff roles v2 (add-role slash command)
- Removing admin/staff roles (remove-role slash command)
- Getting roles (get-roles slash command)
- Added role permissions to channels for ticket creation
- Added documentation so I don't get lazy later and don't do it