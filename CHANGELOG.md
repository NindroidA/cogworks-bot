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