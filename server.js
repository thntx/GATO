const path = require('path');
const express = require('express');
const app = express();

function log(code, msg) {
  const time = new Date().toTimeString().slice(0, 8);
  console.log(`[${time}] [${code || '----'}] ${msg}`);
}

function nick(rooms, code, id) {
  try { return rooms[code].players[id].nick; } catch { return id.slice(0, 6); }
}

const server = require('http').createServer(app); // Changed to createServer
const io = require('socket.io')(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const fs = require('fs');
const CLIENT_DIR = path.join(__dirname, './client');
const DIST_DIR = path.join(__dirname, './client/dist');

// Serve compiled Vite files first if they exist
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
}
// Fallback to serving the raw client folder for unbundled assets (like phaser.js and the assets folder)
app.use(express.static(CLIENT_DIR));

app.get('/', (req, res) => {
  if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  } else {
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  }
});

const COLORS = [
  0xf034fa,
  0x00cc44,
  0xed0047,
  0xffc929,
  0x7024ff,
  0xf97a0a,
  0x07b696
]

// Approximate playback durations (ms) for each per-action sound. The server
// sleeps for these between emits so all clients receive events spaced out
// enough that sounds don't overlap. Peek is exempt — its sound rides on top
// of whatever else is happening. Keep in sync with client-side SOUND_MS in
// Config.js (the actor's UI freezes for these same durations after a local
// emit, so they can't queue the next action before their own sound finishes).
const SOUND_MS = {
  play: 350,
  copy: 500,
  fail: 500,
  trade: 500,
  take: 250,
  peek: 1800
};

// Used for log rows that describe server-driven events (game start/end,
// running out of cards) — same blue as uiConfig.COLOR on the client so the
// rectangle reads as a "neutral" entry.
const SERVER_COLOR = 0x00a6ed;

const DECK_PER_PLAYER = [
  0, 0, 1, 1, 2, 2, 3, 3, 4, 4,
  5, 5, 6, 6, 7, 7, 8, 8, 9, 9,
  10, 10, 11
];


const CARDS = 4;

const rooms = {};

io.on('connection', (socket) => {

  log(null, `CONNECT      ${socket.id.slice(0, 6)}`);

  socket.on('joinRequest', (data, callback) => {

    const code = data.code;
    const playerNick = data.nick;

    if (!rooms[code]) {
      rooms[code] = {
        count: { turn: 0, round: 0, deck: 0 },
        state: 0, // 0: Lobby, 1: Peek phase, 2: Gameplay Loop, 3: Last Round
        players: {},
        leader: socket.id,
        peeks: 0,
        history: {}
      }
      log(code, `ROOM CREATED by ${socket.id.slice(0, 6)}`);
    }

    const room = rooms[code];
    if (!room.history) room.history = {};
    const players = room.players;
    const ids = Object.keys(players);

    if (room.state == 0) {
      if (ids.length < 7) {
        const nick = playerNick || 'Player ' + (ids.length + 1);
        if (Object.values(players).some(p => p.nick === nick)) {
          log(code, `JOIN DENIED  ${socket.id.slice(0, 6)} — nick "${nick}" already taken`);
          callback(false, 'That nickname is already in use in this room.');
          return;
        }
        const restoredPoints = room.history[nick];
        players[socket.id] = {
          nick,
          color: COLORS[ids.length],
          leader: ids.length == 0,
          hand: [[], []],
          hold: null,
          points: restoredPoints ?? 0
        }
        if (restoredPoints !== undefined) {
          delete room.history[nick];
          log(code, `REJOIN       ${nick} restored ${restoredPoints} pts`);
        }

        log(code, `JOIN         ${players[socket.id].nick} (${ids.length + 1}/5 players)`);
        callback(true, { code, players });
        everyone('playerUpdate', { players }, code);

      } else {
        log(code, `JOIN DENIED  ${socket.id.slice(0, 6)} — room full`);
        callback(false, 'Room is full. A maximum of seven players can play together.');
      }
    } else {
      log(code, `JOIN DENIED  ${socket.id.slice(0, 6)} — game in progress`);
      callback(false, 'A game is being played in this room. Try again later.');
    }

  });

  socket.on('leaveRequest', (data) => {

    const code = data.code;
    const id = data.id;
    const room = rooms[code];
    if (!room) return;
    const players = room.players;
    const ids = Object.keys(players);
    const leavingNick = nick(rooms, code, id);

    log(code, `LEAVE        ${leavingNick}`);

    io.to(id).emit('leave');

    if (ids.length == 1) {

      delete rooms[code];
      log(code, `ROOM CLOSED  (empty)`);

    } else {

      if (id == room.leader) {
        const ids = Object.keys(players);
        promote(code, ids[0] !== id ? ids[0] : ids[1]);
      }

      if (players[id]) {
        room.history[players[id].nick] = players[id].points ?? 0;
      }
      delete players[id];
      if (room.knownCards) delete room.knownCards[id];

      const ids = Object.keys(players);
      for (let i = 0; i < ids.length; i++) {
        players[ids[i]].color = COLORS[i];
      }

      everyone('playerUpdate', { players }, code);

    }
  });

  socket.on('promoteRequest', (data) => {

    const code = data.code;
    const id = data.id;

    log(code, `PROMOTE      ${nick(rooms, code, socket.id)} → ${nick(rooms, code, id)}`);
    promote(code, id);

  });

  socket.on('lobbyRequest', (data) => {

    const code = data.code;
    if (rooms[code]) {
      const summary = Object.entries(rooms[code].players)
        .map(([id, p]) => `${p.nick}(leader=${p.leader},pts=${p.points ?? 'undef'})`)
        .join(', ');
      log(code, `LOBBY SYNC   ${nick(rooms, code, socket.id)} | room players: ${summary}`);
      io.to(socket.id).emit('playerUpdate', { players: rooms[code].players });
    } else {
      log(null, `LOBBY SYNC   ${socket.id.slice(0, 6)} requested code=${code} but room not found`);
    }

  });

  socket.on('startRequest', (data) => {

    const code = data.code;
    const room = rooms[code];

    const playerCount = Object.keys(room.players).length;
    const cardKeys = [];
    for (let i = 0; i < playerCount; i++) cardKeys.push(...DECK_PER_PLAYER);
    shuffle(cardKeys);
    room.cardIdCounter = 0;
    room.deck = cardKeys.map(key => ({ id: ++room.cardIdCounter, key }));
    room.knownCards = {};
    for (const pid of Object.keys(room.players)) room.knownCards[pid] = new Set();
    room.cats = 0;
    room.play = [];
    room.state = 1;
    room.count.deck = 1;
    room.outPlayers = [];
    room.peeks = 0;
    room.peeksPerPlayer = {};
    room.peekHistory = {};
    room.standEnabled = false;

    const playerNames = Object.values(room.players).map(p => p.nick).join(', ');
    log(code, `GAME START   players: ${playerNames} | deck: ${room.deck.length} cards`);
    everyone('start', {}, code);

  });

  socket.on('clientReady', async (data) => {

    const code = data.code;
    const room = rooms[code];
    const players = room.players;
    const ids = Object.keys(players);

    players[socket.id].ready = true;
    log(code, `READY        ${nick(rooms, code, socket.id)}`);

    let everyoneReady = true;
    for (const id of ids) {
      if (!players[id].ready) {
        everyoneReady = false;
      }
    }

    if (everyoneReady) {
      log(code, `DEALING      ${CARDS} cards to ${ids.length} players...`);
      logEntry(code, [{ type: 'text', value: 'Game Started' }], SERVER_COLOR);
      for (let i = 0; i < CARDS; i++) {
        for (const id of ids) {
          await sleep(SOUND_MS.take);
          deal(code, id);
        }
      }
      log(code, `PEEK PHASE   waiting for players to peek 2 cards each`);
    }

  });

  socket.on('turnEnd', locked(async (data) => {

    const code = data.code;
    const room = rooms[code];
    if (!room) return;

    const ids = Object.keys(room.players);
    const activeId = ids[room.count.turn];

    // Only the active turn player can end their own turn. Guards against
    // stale/duplicate turnEnd emits — e.g. a client firing turnEnd after
    // the server has already auto-advanced on a 0-card go-out.
    if (socket.id !== activeId) {
      log(code, `TURN END IGN ${nick(rooms, code, socket.id)} is not the active turn player`);
      return;
    }

    advanceTurn(code, socket.id);

  }));

  socket.on('dealRequest', (data) => {

    const code = data.code
    const id = data.id;
    const amount = data.amount;

    log(code, `DEAL REQ     ${nick(rooms, code, id)} x${amount}`);
    for (let i = 0; i < amount; i++) {
      deal(code, id);
    }

  });

  socket.on('drawRequest', locked(async (data, callback) => {

    const code = data.code;
    const room = rooms[code];
    if (!room || room.outPlayers.includes(socket.id)) return;
    const player = room.players[socket.id];

    player.hold = pop(code);
    if (!player.hold) return;

    if (room.knownCards[socket.id]) room.knownCards[socket.id].add(player.hold.id);
    log(code, `DRAW         ${nick(rooms, code, socket.id)} drew card [${player.hold.key}] | deck: ${room.deck.length} left`);
    callback(player.hold.key);
    everyone('draw', { id: socket.id }, code, socket.id);

  }));

  socket.on('moveRequest', (data) => {

    everyone('move', { x: data.x, y: data.y }, data.code, socket.id);

  });

  socket.on('playRequest', locked(async (data) => {

    const code = data.code;
    const room = rooms[code];
    if (!room || room.outPlayers.includes(socket.id)) return;
    const players = room.players;
    const player = players[socket.id];
    const ids = Object.keys(players);
    const cardObj = player.hold;
    if (!cardObj) return;

    room.play.push({
      id: cardObj.id,
      key: cardObj.key,
      pid: socket.id
    });

    player.hold = null;
    forgetCard(room, cardObj.id);

    // Track what sub-action this play set up so a peekRequest / tradeRequest
    // arriving during the play sound's sleep can be associated with the right
    // turn-end. Set BEFORE emit/sleep — sub-action handlers check it.
    if (cardObj.key >= 5 && cardObj.key <= 8) {
      room.activeEffect = { type: 'peek', peeksLeft: 1, requiresTrade: false };
    } else if (cardObj.key === 9) {
      room.activeEffect = { type: 'trade', peeksLeft: 0, requiresTrade: true };
    } else if (cardObj.key === 10) {
      room.activeEffect = { type: 'peekTrade', peeksLeft: 2, requiresTrade: true };
    } else {
      room.activeEffect = null;
    }

    log(code, `PLAY         ${nick(rooms, code, socket.id)} played card [${cardObj.key}] to discard`);
    logEntry(code, [
      { type: 'text', value: nick(rooms, code, socket.id) + ' played a ' },
      { type: 'card', value: cardObj.key }
    ], playerColor(code, socket.id));
    everyone('play', { card: cardObj.key, actorId: socket.id }, code, socket.id);
    checkPlaySounds(code);

    await sleep(SOUND_MS.play);
    if (!rooms[code]) return;

    if (cardObj.key <= 4) {
      // Cards 0-4 deal a +1 penalty to anyone whose hand size matches the
      // played value. dealPenalty sleeps per actual deal and posts a log
      // entry with the real count (a hand-full match would be 0).
      for (const id of ids) {
        if (!rooms[code]) return;
        if (id !== socket.id && !room.outPlayers.includes(id) && handLength(code, id) == cardObj.key) {
          log(code, `PENALTY      ${nick(rooms, code, id)} has ${cardObj.key} cards (matches played value) → +1 card`);
          await dealPenalty(code, id, 1);
        }
      }
      if (rooms[code]) advanceTurn(code, socket.id);
    }
  }));

  socket.on('swapRequest', locked(async (data, callback) => {

    const code = data.code;
    const i = data.i;
    const j = data.j;
    const room = rooms[code];
    if (!room || room.outPlayers.includes(socket.id)) return;
    const players = room.players;
    const player = players[socket.id];
    const hand = player.hand;
    const cardObj = hand[i] ? hand[i][j] : null;
    if (!cardObj || !player.hold) return;

    room.play.push({
      id: cardObj.id,
      key: cardObj.key,
      pid: socket.id
    });

    hand[i][j] = player.hold;
    player.hold = null;
    forgetCard(room, cardObj.id);

    log(code, `SWAP         ${nick(rooms, code, socket.id)} swapped held card into hand[${i}][${j}], discarded [${cardObj.key}]`);
    logEntry(code, [
      { type: 'text', value: nick(rooms, code, socket.id) + ' swapped a ' },
      { type: 'card', value: cardObj.key }
    ], playerColor(code, socket.id));
    callback(cardObj.key);
    everyone('swap', { id: socket.id, card: cardObj.key, i, j }, code, socket.id);
    checkPlaySounds(code);

    // Swap discards a card to the playstack (same play sound). Wait for it
    // before any +3 take sounds (CAT swap-in penalty) and the turn advance.
    await sleep(SOUND_MS.play);
    if (!rooms[code]) return;

    if (cardObj.key == 11) {
      log(code, `PENALTY      ${nick(rooms, code, socket.id)} swapped a CAT [11] into hand → +3 cards`);
      await dealPenalty(code, socket.id, 3);
    }

    // Swap always ends the active player's turn. Client no longer emits
    // turnEnd for swap — server owns the sequence.
    if (rooms[code]) advanceTurn(code, socket.id);

  }));

  socket.on('copyRequest', locked(async (data, callback) => {

    const code = data.code;
    const id = data.id;
    const i = data.i;
    const j = data.j;
    const room = rooms[code];
    if (!room) return;
    if (room.outPlayers.includes(socket.id)) return;
    if (room.outPlayers.includes(id)) return;
    const play = room.play;

    const cardObj = room.players[id] && room.players[id].hand[i] ? room.players[id].hand[i][j] : null;
    // The slot may have been emptied by a concurrent action (another player
    // copied / traded the card before this request landed). Always close the
    // callback loop so the client can revert its visual drag instead of
    // freezing at the drop point.
    if (!cardObj) {
      log(code, `COPY MISS    ${nick(rooms, code, socket.id)} targeted hand[${i}][${j}] but slot was empty`);
      callback(null);
      return;
    }

    // A player may only copy a card they have personally seen at some point in
    // this game (peek phase, peek effects 5/6/7/8/10, or drawing). Knowledge is
    // per-player and tracked by stable card id, so it follows the card through
    // trades but is cleared when the card hits the discard pile (forgetCard).
    // The client mirrors this rule by gating its playstack drop zone on
    // card.known, so this server-side check is a defensive backstop that
    // shouldn't fire under normal play.
    if (!room.knownCards[socket.id] || !room.knownCards[socket.id].has(cardObj.id)) {
      log(code, `COPY DENIED  ${nick(rooms, code, socket.id)} tried to copy unseen card hand[${i}][${j}]`);
      callback(null);
      return;
    }

    room.players[id].hand[i].splice(j, 1);
    const card = cardObj.key;
    const prevTop = play[play.length - 1];
    // A normal (non-CAT) copy is only legal if the current discard top matches
    // AND it is not itself already a successful copy. This prevents multiple
    // players from all copying the same rank in a row: only the first copy on
    // top of a freshly-thrown card counts; any subsequent copy on top of that
    // one is illegal. If an illegal copy is played, its entry is NOT marked as
    // a copy, so the next matching card played on top of it can be legal again.
    const isLegalNormalCopy = card !== 11 && prevTop && card === prevTop.key && !prevTop.isCopy;

    play.push({
      id: cardObj.id,
      key: card,
      pid: socket.id,
      isCopy: isLegalNormalCopy
    });

    forgetCard(room, cardObj.id);

    const len = play.length;
    const top = play[len - 2];
    const bottom = play[len - 3];

    // success = "copy went through with no penalty for the copier". Mirrors
    // the penalty-branch conditions below so the client can play the right
    // copy/fail sound without re-deriving the rules. CAT success additionally
    // requires a real doble (top is a successful copy and the copier wasn't
    // part of forming it).
    const success = card === 11
      ? !!(top && bottom && top.isCopy && top.pid !== socket.id && bottom.pid !== socket.id)
      : isLegalNormalCopy;

    const copierNick = nick(rooms, code, socket.id);
    const targetNick = nick(rooms, code, id);
    const topCard = prevTop;

    log(code, `COPY         ${copierNick} copied ${targetNick}'s hand[${i}][${j}] = [${card}] | discard top was [${topCard ? topCard.key : 'none'}]${topCard && topCard.isCopy ? ' (already a copy)' : ''} | ${success ? 'CORRECT' : 'WRONG'}`);
    // Log row segments depend on success and on whether the source was the
    // copier's own hand or somebody else's.
    const verb = success ? 'copied' : 'failed';
    const copySegments = [{ type: 'text', value: copierNick + ' ' + verb + ' a ' }, { type: 'card', value: card }];
    if (id !== socket.id) copySegments.push({ type: 'text', value: ' from ' + targetNick });
    logEntry(code, copySegments, playerColor(code, socket.id));
    callback({ key: card, success });
    everyone('copy', { id, card, i, j, copierId: socket.id, success }, code, socket.id);
    checkPlaySounds(code);

    // Hold the next event back until the copy/fail sound has played out, so
    // the take sounds for any penalty deals don't trample the copy/fail.
    await sleep(success ? SOUND_MS.copy : SOUND_MS.fail);
    if (!rooms[code]) return;

    // Si no és un gat:
    if (card !== 11) {
      // Si t'has equivocat, penca 2:
      if (!isLegalNormalCopy) {
        log(code, `PENALTY      ${copierNick} wrong copy → +2 cards`);
        await dealPenalty(code, socket.id, 2);
        // Si no t'has equivocat i la carta és d'un altre, l'altre penca 2:
      } else if (id !== socket.id) {
        log(code, `PENALTY      ${targetNick} had card correctly copied → +2 cards`);
        await dealPenalty(code, id, 2);
      } else {
        log(code, `COPY OK      ${copierNick} copied own card correctly, no penalty`);
      }
      // Si ho és:
    } else {
      // CAT rules:
      //  - A "doble" (valid pair to discard a CAT onto) only exists when the
      //    top card is a successful copy (top.isCopy === true). Two cards of
      //    the same rank that landed on the pile via normal plays do NOT form
      //    a doble. An illegal copy (isCopy:false) covering a real doble also
      //    invalidates it (the doble is considered consumed/covered).
      //  - The CAT thrower must not have participated in the doble, i.e.
      //    socket.id must differ from top.pid and bottom.pid.
      //  - Rule "no dobles con gatos" is enforced upstream: isCopy is never
      //    set to true for a CAT, so a CAT can never be part of a doble.
      // Si t'has equivocat, penca 3:
      if (!top || !bottom || !top.isCopy || top.pid == socket.id || bottom.pid == socket.id) {
        log(code, `PENALTY      ${copierNick} wrong CAT copy → +3 cards`);
        await dealPenalty(code, socket.id, 3);
        // Si no t'has equivocat i la carta és d'un altre, l'altre penca 3:
      } else if (id !== socket.id) {
        log(code, `PENALTY      ${targetNick} had CAT correctly copied → +3 cards`);
        await dealPenalty(code, id, 3);
      } else {
        log(code, `COPY OK      ${copierNick} copied own CAT correctly, no penalty`);
      }
    }

    // If the copied player ran out of cards, mark them out.
    if (handLength(code, id) === 0) {
      enterLastRound(code, id, 'empty');
    }

    // Server-authoritative auto-end: if the player whose turn it currently is
    // has zero cards, advance the turn immediately. Doesn't depend on any
    // client emitting turnEnd, so the game can't get stuck regardless of
    // how/when the active player hit 0 (self-copy, being copied, etc.).
    if (rooms[code]) {
      const activeId = Object.keys(rooms[code].players)[rooms[code].count.turn];
      if (activeId && handLength(code, activeId) === 0) {
        log(code, `AUTO END     ${nick(rooms, code, activeId)} has 0 cards → advancing turn`);
        advanceTurn(code, activeId);
      }
    }

    // The active player can complete a peek (5/6/7/8) or peekTrade (10)
    // effect by copying instead of waiting / trading. If we still have an
    // activeEffect after the copy resolves, treat the copy as the effect's
    // completion and advance the turn — the corresponding peek/trade
    // auto-advance path snapshotted activeEffect and will skip itself
    // because we cleared it via advanceTurn.
    if (rooms[code]) {
      const activeId = Object.keys(rooms[code].players)[rooms[code].count.turn];
      if (activeId && socket.id === activeId && rooms[code].activeEffect) {
        log(code, `AUTO END     ${nick(rooms, code, activeId)} completed effect via copy → advancing turn`);
        advanceTurn(code, activeId);
      }
    }

  }));

  socket.on('peekRequest', locked(async (data, callback) => {

    const code = data.code;
    const i = data.i;
    const j = data.j;
    const id = data.id;
    const room = rooms[code];
    if (!room) return;
    if (room.state !== 1) {
      if (room.outPlayers.includes(socket.id)) return;
      if (room.outPlayers.includes(id)) return;
    }
    const players = room.players;
    const ids = Object.keys(players);
    const cardObj = players[id] && players[id].hand[i] ? players[id].hand[i][j] : null;
    if (!cardObj) return;
    const phase = room.state == 1 ? 'peek phase' : 'gameplay';

    if (room.knownCards && room.knownCards[socket.id]) {
      room.knownCards[socket.id].add(cardObj.id);
    }
    log(code, `PEEK         ${nick(rooms, code, socket.id)} peeked ${nick(rooms, code, id)}'s hand[${i}][${j}] = [${cardObj.key}] (${phase})`);
    callback(cardObj.key);
    everyone('peek', { peekerId: socket.id, peekedId: id, peekedI: i, peekedJ: j }, code, socket.id);

    // Peek phase
    if (room.state == 1) {

      // Track per-player peek-key history (in click order) for the room-67
      // easter egg, and the simple count for the "peeked their cards" log.
      if (!room.peekHistory) room.peekHistory = {};
      if (!room.peekHistory[socket.id]) room.peekHistory[socket.id] = [];
      room.peekHistory[socket.id].push(cardObj.key);

      if (!room.peeksPerPlayer) room.peeksPerPlayer = {};
      room.peeksPerPlayer[socket.id] = (room.peeksPerPlayer[socket.id] || 0) + 1;
      if (room.peeksPerPlayer[socket.id] === 2) {
        logEntry(code, [{ type: 'text', value: nick(rooms, code, socket.id) + ' peeked their cards' }], playerColor(code, socket.id));
        // Room-67 easter egg: a player's two initial peeks were [6, 7].
        const seq = room.peekHistory[socket.id];
        if (code === '67' && seq.length === 2 && seq[0] === 6 && seq[1] === 7) {
          io.to(socket.id).emit('sound', { name: 'sixSeven' });
        }
      }

      room.peeks += 1
      log(code, `PEEK PHASE   ${room.peeks}/${2 * ids.length} peeks done`);

      if (room.peeks == 2 * ids.length) {
        delete room.peeks
        room.state = 2;
        log(code, `GAMEPLAY     all players peeked — starting turn 1 round 1`);
        // Initial peeks stay snappy — no sleep before turnStart even though
        // the last peek's audio may briefly overlap the first turn sound.
        everyone('turnStart', { id: ids[room.count.turn], turn: room.count.turn, round: room.count.round }, code);
      }

    } else {

      // Log every gameplay peek with the right wording — "peeked a card"
      // for self-peeks (5/6 or own half of 10), "peeked a card from <p>"
      // for alien peeks (7/8 or alien half of 10).
      if (socket.id === id) {
        logEntry(code, [{ type: 'text', value: nick(rooms, code, socket.id) + ' peeked a card' }], playerColor(code, socket.id));
      } else {
        logEntry(code, [{ type: 'text', value: nick(rooms, code, socket.id) + ' peeked a card from ' + nick(rooms, code, id) }], playerColor(code, socket.id));
      }

      // Gameplay peek that resolves an active effect: 5/6/7/8 use one peek
      // and end the turn; 10's peekTrade burns two peeks before the trade
      // (the trade itself triggers the turn advance with its own sleep).
      const activeId = ids[room.count.turn];
      if (socket.id === activeId && room.activeEffect && room.activeEffect.peeksLeft > 0) {
        if (!room.activeEffect.peekedKeys) room.activeEffect.peekedKeys = [];
        room.activeEffect.peekedKeys.push(cardObj.key);
        room.activeEffect.peeksLeft--;

        // Room-67 easter egg: card 10's two peeks were [6, 7] in order.
        if (code === '67' && room.activeEffect.type === 'peekTrade' && room.activeEffect.peekedKeys.length === 2) {
          const seq = room.activeEffect.peekedKeys;
          if (seq[0] === 6 && seq[1] === 7) {
            io.to(socket.id).emit('sound', { name: 'sixSeven' });
          }
        }

        if (room.activeEffect.peeksLeft === 0 && !room.activeEffect.requiresTrade) {
          // Single-peek effect (5-8) complete. Schedule the advance via
          // setTimeout (outside the room lock) instead of awaiting inside
          // the lock — otherwise the 1.8s peek wait blocks the active
          // player's own drag-to-copy of the peeked card, since the copy
          // request would queue behind us. The retry re-acquires the
          // lock when the timer fires and only advances if the activeEffect
          // snapshot still matches (no other path cleared/replaced it).
          const expected = room.activeEffect;
          setTimeout(async () => {
            if (!rooms[code]) return;
            await withRoomLock(rooms[code], async () => {
              if (rooms[code] && rooms[code].activeEffect === expected) {
                advanceTurn(code, socket.id);
              }
            });
          }, SOUND_MS.peek);
        }
      }

    }

  }));

  socket.on('disconnect', () => {

    for (const code of Object.keys(rooms)) {
      const room = rooms[code];
      const players = room.players;

      if (!players[socket.id]) continue;

      const leavingNick = nick(rooms, code, socket.id);
      log(code, `DISCONNECT   ${leavingNick} (${socket.id.slice(0, 6)}) dropped`);

      const ids = Object.keys(players);

      if (ids.length === 1) {
        delete rooms[code];
        log(code, `ROOM CLOSED  (empty after disconnect)`);
      } else {
        if (socket.id === room.leader) {
          const next = ids.find(id => id !== socket.id);
          promote(code, next);
        }

        room.history[players[socket.id].nick] = players[socket.id].points ?? 0;
        delete players[socket.id];
        if (room.knownCards) delete room.knownCards[socket.id];

        const newIds = Object.keys(players);
        for (let i = 0; i < newIds.length; i++) {
          players[newIds[i]].color = COLORS[i];
        }

        const remaining = newIds.map(id => `${players[id].nick}(leader=${players[id].leader},pts=${players[id].points ?? 'undef'})`).join(', ');
        log(code, `DISCONNECT   sending playerUpdate | remaining: ${remaining}`);
        everyone('playerUpdate', { players }, code);
      }

      break;
    }

    log(null, `DISCONNECT   ${socket.id.slice(0, 6)}`);

  });

  socket.on('tradeRequest', locked(async (data) => {

    const code = data.code;
    const traderId = data.traderId;
    const tradedId = data.tradedId;
    const traderI = data.traderI;
    const tradedI = data.tradedI;
    const traderJ = data.traderJ;
    const tradedJ = data.tradedJ;
    if (!rooms[code]) return;
    // The requester must be one of the two parties in the trade. Without this
    // check, the unified drag/drop UI lets a client drag any alien card onto
    // any other alien card — which would otherwise serialize into a valid
    // tradeRequest and have the server swap two cards neither of which the
    // requester owns.
    if (socket.id !== traderId && socket.id !== tradedId) {
      log(code, `TRADE DENIED ${nick(rooms, code, socket.id)} not a party in ${nick(rooms, code, traderId)} ↔ ${nick(rooms, code, tradedId)}`);
      return;
    }
    if (rooms[code].outPlayers.includes(traderId)) return;
    if (rooms[code].outPlayers.includes(tradedId)) return;
    const room = rooms[code];
    const players = room.players;
    const traderHand = players[traderId].hand;
    const tradedHand = players[tradedId].hand;

    log(code, `TRADE        ${nick(rooms, code, traderId)} hand[${traderI}][${traderJ}] ↔ ${nick(rooms, code, tradedId)} hand[${tradedI}][${tradedJ}]`);

    const temp = traderHand[traderI][traderJ];
    traderHand[traderI][traderJ] = tradedHand[tradedI][tradedJ];
    tradedHand[tradedI][tradedJ] = temp;

    everyone('trade', { traderId, tradedId, traderI, traderJ, tradedI, tradedJ, actorId: socket.id }, code, socket.id)

    const otherId = socket.id === traderId ? tradedId : traderId;
    logEntry(code, [{ type: 'text', value: nick(rooms, code, socket.id) + ' traded cards with ' + nick(rooms, code, otherId) }], playerColor(code, socket.id));

    // If the active player just completed their card 9 / card 10 effect,
    // hold the turn change back until the trade sound has played, then
    // advance. activeEffect is cleared inside advanceTurn. Snapshot the
    // effect so a concurrent copy-as-completion doesn't cause us to
    // double-advance after they've already advanced.
    const activeId = Object.keys(room.players)[room.count.turn];
    if (socket.id === activeId && room.activeEffect && room.activeEffect.requiresTrade) {
      const expected = room.activeEffect;
      await sleep(SOUND_MS.trade);
      if (rooms[code] && rooms[code].activeEffect === expected) advanceTurn(code, socket.id);
    }

  }));

  socket.on('standRequest', locked(async (data) => {

    const code = data.code;
    const room = rooms[code];
    if (!room || !room.standEnabled) return;
    if (room.outPlayers.includes(socket.id)) return;

    const activeId = Object.keys(room.players)[room.count.turn];
    if (socket.id !== activeId) return;

    const player = room.players[socket.id];
    if (player.hold !== null && player.hold !== undefined) return;

    log(code, `STAND        ${nick(rooms, code, socket.id)} chose to stand`);
    logEntry(code, [{ type: 'text', value: nick(rooms, code, socket.id) + ' stood' }], playerColor(code, socket.id));

    enterLastRound(code, socket.id, 'stand');

    if (rooms[code]) {
      log(code, `AUTO END     ${nick(rooms, code, socket.id)} stood on own turn → advancing turn`);
      advanceTurn(code, socket.id);
    }

  }));

});

server.listen(8081, function () {
  console.log(`Listening on ${server.address().port}`);
});

function sleep(ms) {

  return new Promise(resolve => setTimeout(resolve, ms));

}

function everyone(event, data, code, except = null) {

  const ids = Object.keys(rooms[code].players);

  for (const id of ids) {
    if (id !== except) {
      io.to(id).emit(event, data);

    }
  }
}

function promote(code, id) {

  const room = rooms[code];
  const players = room.players;
  const player = players[id];

  players[room.leader].leader = false;
  room.leader = id;
  player.leader = true;

  everyone('playerUpdate', { players }, code);

}

function shuffle(deck) {

  let currentIndex = deck.length;

  while (currentIndex !== 0) {
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    [deck[currentIndex], deck[randomIndex]] = [deck[randomIndex], deck[currentIndex]];

  }

  return deck;

}

function reshuffle(code) {

  const room = rooms[code];
  const play = room.play;

  // Carry the {id, key} pair back into the deck so card identity is preserved
  // through reshuffles. play entries also carry pid/isCopy which are play-only,
  // so strip those.
  const reshuffled = play.slice(0, play.length - 2).map(c => ({ id: c.id, key: c.key }));
  room.deck = shuffle(reshuffled);

  // Trim the play pile to match what the client keeps (last 2 cards),
  // so server and client deck sizes stay in sync on subsequent reshuffles.
  room.play = play.slice(play.length - 2);

  const deck = room.deck;
  let len = deck.length;
  let catsRemoved = 0;
  for (let i = 0; i < len; i++) {
    if (deck[i].key == 11) {
      room.cats += 1;
      deck.splice(i, 1);
      i--;
      len--;
      catsRemoved++;
    }
  }

  room.count.deck++;
  log(code, `RESHUFFLE    deck #${room.count.deck} | ${deck.length} cards (${catsRemoved} cats removed, total cats out: ${room.cats})`);

}

function enterLastRound(code, outId, reason) {

  const room = rooms[code];
  if (!room) return;

  // Idempotent: a given player is only recorded as out once.
  if (room.outPlayers.includes(outId)) return;

  room.outPlayers.push(outId);
  if (room.players[outId]) {
    room.players[outId].outBy = reason;
  }

  if (room.state < 3) {
    room.state = 3;
    room.lastRoundNum = room.count.round + 1;
    log(code, `LAST ROUND   ${nick(rooms, code, outId)} went out | game ends after round ${room.lastRoundNum + 1}`);
  } else {
    log(code, `OUT          ${nick(rooms, code, outId)} went out (last round already active)`);
  }

  if (reason === 'empty') {
    logEntry(code, [{ type: 'text', value: nick(rooms, code, outId) + ' ran out of cards' }], SERVER_COLOR);
  }

  everyone('lastRound', { eliminatedId: outId, lastRoundNum: room.lastRoundNum }, code);

}

function advanceTurn(code, endingId) {

  const room = rooms[code];
  if (!room) return;
  // The current active player's effect (if any) is consumed by reaching this
  // point — either the effect ran to completion, or the player skipped it.
  // The next active player starts with no effect.
  room.activeEffect = null;

  const ids = Object.keys(room.players);
  const endingNick = nick(rooms, code, endingId);
  const eliminated = room.outPlayers || [];

  let nextTurn = room.count.turn;
  let nextRound = room.count.round;
  const skipped = [];

  let safety = 0;
  do {
    nextTurn = (nextTurn + 1) % ids.length;
    if (nextTurn === 0) nextRound++;
    if (eliminated.includes(ids[nextTurn])) {
      skipped.push(nick(rooms, code, ids[nextTurn]));
    }
    safety++;
  } while (eliminated.includes(ids[nextTurn]) && safety < ids.length);

  room.count.turn = nextTurn;
  room.count.round = nextRound;

  if (skipped.length > 0) {
    log(code, `SKIP         ${skipped.join(', ')} (out)`);
  }

  if (!room.standEnabled && room.count.round > 0) {
    room.standEnabled = true;
    log(code, `STAND ENABLE round ${room.count.round + 1} — players may now stand`);
    everyone('standEnable', {}, code);
  }

  const allOut = ids.every(id => eliminated.includes(id));

  if (room.state === 3 && (allOut || nextRound > room.lastRoundNum)) {
    log(code, `GAME OVER    ${allOut ? 'all players stood' : `end of round ${room.lastRoundNum + 1}`}`);
    logEntry(code, [{ type: 'text', value: 'Game Ended' }], SERVER_COLOR);

    // Compute game scores and accumulate into player.points
    const playersWithCats = Object.values(room.players)
      .filter(p => p.hand.flat().some(c => c.key === 11)).length;

    const gameScores = {};
    for (const [id, p] of Object.entries(room.players)) {
      const cards = p.hand.flat();
      const cats = cards.filter(c => c.key === 11).length;
      const nonCatSum = cards.filter(c => c.key !== 11).reduce((sum, c) => sum + c.key, 0);

      const catScore = playersWithCats > 1
        ? cats * 10
        : (cats > 0 ? -10 + (cats - 1) * 10 : 0);

      const score = nonCatSum + catScore;
      const before = p.points ?? 0;
      p.points = before + score;
      gameScores[id] = score;
      const handKeys = p.hand.map(row => row.map(c => c.key));
      log(code, `SCORE        ${nick(rooms, code, id)} hand=${JSON.stringify(handKeys)} cats=${cats} catScore=${catScore} score=${score} before=${before} total=${p.points}`);
    }

    everyone('gameEnd', {
      players: Object.fromEntries(
        Object.entries(room.players).map(([id, p]) => [id, {
          nick: p.nick,
          hand: p.hand.map(row => row.map(c => c.key)),
          color: p.color,
          points: p.points,
          leader: p.leader,
          score: gameScores[id],
          outBy: p.outBy
        }])
      )
    }, code);

    // Reset room to lobby state for rematch
    room.state = 0;
    room.count = { turn: 0, round: 0, deck: 0 };
    room.outPlayers = [];
    room.cats = 0;
    delete room.lastRoundNum;
    room.standEnabled = false;
    room.knownCards = {};
    room.cardIdCounter = 0;
    room.peeksPerPlayer = {};
    room.peekHistory = {};
    for (const p of Object.values(room.players)) {
      p.hand = [[], []];
      p.hold = null;
      p.ready = false;
      delete p.outBy;
    }

    log(code, `ROOM RESET   back to lobby`);
    everyone('playerUpdate', { players: room.players }, code);
    return;
  }

  const nextNick = nick(rooms, code, ids[nextTurn]);
  log(code, `TURN END     ${endingNick} → next: ${nextNick} (turn ${nextTurn + 1}, round ${nextRound + 1})`);
  everyone('turnStart', { id: ids[nextTurn], turn: nextTurn, round: nextRound }, code);

}

// Returns true if a card was actually dealt, false if the deal couldn't
// happen (hand is at the 14-card cap or the deck couldn't produce a card).
// Callers in penalty loops use this so they only sleep / log for the takes
// that really happened — without it, the "+2 cards" loop would still burn
// SOUND_MS.take per iteration even when the player's hand was already full.
function deal(code, id) {

  if (!rooms[code]) return false;

  if (handLength(code, id) == 14) {
    log(code, `DEAL SKIP    ${nick(rooms, code, id)} already has 14 cards`);
    return false;
  }

  const room = rooms[code];
  const players = room.players;
  const player = players[id];
  const hand = player.hand;

  const card = pop(code);
  if (!card) {
    log(code, `DEAL SKIP    no card available from deck`);
    return false;
  }

  let line = 0;
  let min = -1;
  for (let i = 0; i < 2; i++) {
    if (min == -1 || min > hand[i].length) {
      min = hand[i].length;
      line = i;
    }
  }

  hand[line].push(card);

  log(code, `DEAL         [${card.key}] → ${nick(rooms, code, id)} row ${line} (hand: ${JSON.stringify(hand.map(r => r.length))})`);
  everyone('deal', { id, line }, code);

  return true;
}

// Common penalty-deal helper. Tries to deal `count` cards to `id`, sleeping
// SOUND_MS.take only after each successful deal so the take sounds line up
// with actual emits. After the sequence, drops a "took N cards" log row
// with the real count (or no row at all if 0). Used by 0-4 plays, copy
// fails, copy successes against another player, and CAT-swap penalties.
async function dealPenalty(code, id, count) {

  let dealt = 0;
  for (let i = 0; i < count; i++) {
    if (!rooms[code]) break;
    if (deal(code, id)) {
      dealt++;
      await sleep(SOUND_MS.take);
    } else {
      break;
    }
  }
  if (dealt > 0 && rooms[code]) {
    const cards = dealt === 1 ? 'card' : 'cards';
    logEntry(code, [{ type: 'text', value: nick(rooms, code, id) + ' took ' + dealt + ' ' + cards }], playerColor(code, id));
  }
  return dealt;

}

// Per-room mutex. Wraps an async operation so only one such operation is
// "in flight" per room at a time — others queue up behind it. Solves the
// race where (e.g.) a copy fired during the active player's 0-4 penalty
// loop interleaves its own emits, producing on-screen sound/event ordering
// like "take, take, turn, take" because both sequences raced. With the
// lock, the second handler waits until the first releases before emitting.
async function withRoomLock(room, fn) {

  if (!room) return;
  if (room.actionLock) {
    await new Promise(resolve => {
      room.actionQueue = room.actionQueue || [];
      room.actionQueue.push(resolve);
    });
  }
  room.actionLock = true;
  try {
    return await fn();
  } finally {
    room.actionLock = false;
    const next = room.actionQueue && room.actionQueue.shift();
    if (next) next();
  }

}

// Decorator that runs a socket handler under the room's lock, so all
// game-action handlers (play/swap/copy/trade/peek/stand/turnEnd/draw)
// serialize per-room and their emits never interleave across handlers.
function locked(handler) {
  return async (...args) => {
    const data = args[0];
    const room = data && rooms[data.code];
    if (!room) return await handler(...args);
    return await withRoomLock(room, () => handler(...args));
  };
}

function pop(code) {

  if (!rooms[code]) return null;

  const room = rooms[code];

  if (room.deck.length == 0) {
    reshuffle(code);
    everyone('reshuffle', { deck: room.count.deck }, code);
  }

  const card = room.deck.pop();

  if (room.deck.length == 0) {
    reshuffle(code);
    everyone('reshuffle', { deck: room.count.deck }, code);
  }

  return card;
}

function checkPlaySounds(code) {

  const room = rooms[code];
  if (!room) return;
  const play = room.play;
  const top = play[play.length - 1];
  const prev = play[play.length - 2];

  // Easter egg: only rooms named "67" hear the six-seven sting when a 7
  // lands on a 6 in the discard pile.
  if (code === '67' && top && prev && top.key === 7 && prev.key === 6) {
    everyone('sound', { name: 'sixSeven' }, code);
  }

}

// Erase a card id from every player's known set. Called whenever a card moves
// out of a hand into the discard pile (play/copy/swap). Trades preserve
// knowledge — they don't go through here. Reshuffling carries forgotten ids
// back into the deck untouched, so a later re-deal arrives unknown to all
// players unless somebody re-peeks it.
function forgetCard(room, cardId) {

  if (!room.knownCards) return;
  for (const set of Object.values(room.knownCards)) {
    set.delete(cardId);
  }

}

// Broadcast a row to every client's bottom-right action log. Segments are
// either {type:'text', value:string} or {type:'card', value:keyNumber} —
// the client renders them inline so card icons appear next to the action
// description. Color tints the row's translucent background and identifies
// the actor: SERVER_COLOR for server-driven events, the player's own
// COLORS[i] for player actions.
function logEntry(code, segments, color) {

  if (!rooms[code]) return;
  everyone('logEntry', { segments, color }, code);

}

// Player colour lookup with a fallback to SERVER_COLOR for safety, used by
// log emission sites where the actor's player record is expected to exist.
function playerColor(code, id) {

  if (rooms[code] && rooms[code].players[id]) return rooms[code].players[id].color;
  return SERVER_COLOR;

}

function handLength(code, id) {

  const room = rooms[code];
  const players = room.players;
  const player = players[id];
  const hand = player.hand;

  let length = 0;
  for (let i = 0; i < hand.length; i++) {
    length += hand[i].length;
  }

  return length;
}