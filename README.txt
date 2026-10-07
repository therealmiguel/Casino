MIGUEL'S CASINO: PUTTING IT ON THE INTERNET
==========================================

What's in this folder
  server.js         the server: shows the casino, keeps every bankroll, runs the admin room
  accounts.js       player accounts: the only place money ever changes
  games.js          blackjack, roulette, craps and Dynamite Diggers, played on the server
  games2.js         Plinko, Gem Mines, Cluck Crossing, Cosmic Cascade and Tomb of Amun-Ra
  book_engine.js    the rules and payouts of the Tomb of Amun-Ra book slot
  progress.js       levels, VIP, daily bonus, challenges, badges, Mega Jackpot,
                    weekly tournament, seasons, tips and happy hours
  cascade_engine.js the rules and payouts of Cosmic Cascade
  live2.js          the live Rocket Crash, Baccarat and Dice City tables, and the table chat
  wordfilter.js     keeps swear words and slurs out of chat and player names
  bj_solo.js        the blackjack dealer for the solo table
  roulette_rules.js, craps_rules.js, slot_engine.js   the rules and payouts of each game
  live.js           the live tables: shared blackjack (5 seats), roulette and Hold'em
  poker.js          the live Texas Hold'em table (6 seats, no limit)
  backroom.tpl      the admin room (only shown at your secret address)
  package.json      tells the hosting service how to start the server
  public/ or *.html the casino pages themselves

You need three free accounts. It takes about 20 minutes the first time.
  Upstash  keeps every bankroll saved
  GitHub   holds these files
  Render   runs the server and gives you a web address to share


HOW THE MONEY IS KEPT SAFE
  Every bankroll lives on the server, never in the browser. The server deals
  the cards, spins the wheels and reels and rolls the dice, and it pays out
  itself. A page can only ask to place a bet; the server checks the table
  limits, the rules and the player's balance first. Editing a page, the
  browser's storage or its requests can't create money. Every attempt is
  written to the security log in the admin room.
  A fresh $1,000 is only given when a player is out of chips everywhere, and
  it counts as a reset on the leaderboard.


STEP 1: UPSTASH (the casino's memory)
  1. Go to https://upstash.com and sign up.
  2. Create a database: choose Redis, name it miguels-casino, pick the
     region closest to you (for Vienna: Frankfurt / eu-central-1) and the
     Free plan.
  3. Open the database. In the "REST API" section, copy these two values
     into a note:
        UPSTASH_REDIS_REST_URL     (starts with https://)
        UPSTASH_REDIS_REST_TOKEN   (a long code; keep it private)


STEP 2: GITHUB (where the files live)
  1. Go to https://github.com and sign up.
  2. Click "New repository". Name it miguels-casino and click
     "Create repository".
  3. Click "uploading an existing file" and drag in everything in this
     folder (all the .js files, backroom.tpl, package.json, README.txt and
     the .html pages).
  4. Click "Commit changes".


STEP 3: RENDER (puts it online)
  1. Go to https://render.com and sign up with your GitHub account.
  2. Click "New" > "Web Service" and choose the miguels-casino repository.
  3. Fill in:
        Language / Runtime   Node
        Build command        npm install
        Start command        node server.js
        Instance type        Free
  4. Under "Environment Variables" add the two values from step 1,
     with exactly these names:
        UPSTASH_REDIS_REST_URL
        UPSTASH_REDIS_REST_TOKEN
  5. Click "Deploy". After a minute or two Render shows your address,
     something like https://miguels-casino.onrender.com


STEP 4: THE ADMIN ROOM (only for you)
  In Render, open the service > "Environment" and add three more values:
        ADMIN_USER       your username, for example miguel
        ADMIN_PASSWORD   a long password nobody could guess (12+ characters)
        ADMIN_PATH       a secret address, letters, numbers and dashes only,
                         for example backroom-k7x2p9
  Save; Render restarts the site. The admin room is then at
        https://YOUR-ADDRESS/backroom-k7x2p9      (your own ADMIN_PATH)
  It isn't linked from anywhere, every other address answers "Not found",
  and after 5 wrong passwords that network is locked out for 15 minutes.
  Never put these three values in GitHub; they only belong in Render.

  In the admin room you can:
    - see everyone's bankroll, history, alerts and which network they use
    - set or adjust a bankroll, rename, suspend, hide from the leaderboard,
      remove from the live tables, clear stats, or delete a profile
    - read the security log (cheating attempts, wrong passwords, odd bets)
    - see the house books: what each game took in and paid out
    - post an announcement banner, gift chips to everyone, close the casino
      for a moment, lock out new players, and download a backup
    - read the table chat, remove messages, clear it, and mute a player
    - start the Casino Wheel: everyone online gets one free spin (up to $100,000)
    - start a happy hour (wins boosted x1.5, x2 or x3 on one game or all),
      double XP, or give everyone free spins
    - set the weekly tournament prizes, end the tournament or the season early,
      and set the Mega Jackpot pot


CHECK IT WORKS
  Open  https://YOUR-ADDRESS/api/health
  You should see  "ok":true,  "ready":true,  "storage":"upstash"  and every
  page marked "found". If it says "file" instead, the two Upstash values are
  missing or misspelled in Render's Environment Variables.


GOOD TO KNOW
  - Render's free server goes to sleep after 15 minutes with no visitors.
    The next visitor waits about a minute while it wakes up. Everything is
    kept safe in Upstash the whole time.
  - A player's seat belongs to their browser. On a new phone or computer
    they start a new seat.
  - To change the casino later, upload the new files to the same GitHub
    repository. Render updates the site automatically. Close the casino in
    the admin room first if people are playing.
  - If the server restarts in the middle of a hand, every chip on a live
    table goes back to its owner, and an unfinished solo blackjack hand is
    played out (standing) the next time that player opens the table.


PLAY ON YOUR OWN COMPUTER INSTEAD
  Install Node.js from https://nodejs.org, open a terminal in this folder
  and run:   node server.js
  Then open  http://localhost:3000
  Everything is then saved in the data/ folder next to server.js.
