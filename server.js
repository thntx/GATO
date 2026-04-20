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
  0x7024ff
]

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
        peeks: 0
      }
      log(code, `ROOM CREATED by ${socket.id.slice(0, 6)}`);
    }

    const room = rooms[code];
    const players = room.players;
    const ids = Object.keys(players);

    if (room.state == 0) {
      if (ids.length < 5) {
        players[socket.id] = {
          nick: playerNick || 'Player ' + (ids.length + 1),
          color: COLORS[ids.length],
          leader: ids.length == 0,
          hand: [[], []],
          hold: null
        }

        log(code, `JOIN         ${players[socket.id].nick} (${ids.length + 1}/5 players)`);
        callback(true, { code, players });
        everyone('playerUpdate', { players }, code);

      } else {
        log(code, `JOIN DENIED  ${socket.id.slice(0, 6)} — room full`);
        callback(false, 'Room is full. A maximum of five players can play together.');
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

      delete players[id];

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
    const deck = [];
    for (let i = 0; i < playerCount; i++) deck.push(...DECK_PER_PLAYER);
    room.deck = shuffle(deck);
    room.cats = 0;
    room.play = [];
    room.state = 1;
    room.count.deck = 1;
    room.outPlayers = [];
    room.peeks = 0;
    room.firstReshuffleHappened = false;
    room.firstReshuffleRound = null;
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
      for (let i = 0; i < CARDS; i++) {
        for (const id of ids) {
          await sleep(200);
          deal(code, id);
        }
      }
      log(code, `PEEK PHASE   waiting for players to peek 2 cards each`);
    }

  });

  socket.on('turnEnd', (data) => {

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

  });

  socket.on('dealRequest', (data) => {

    const code = data.code
    const id = data.id;
    const amount = data.amount;

    log(code, `DEAL REQ     ${nick(rooms, code, id)} x${amount}`);
    for (let i = 0; i < amount; i++) {
      deal(code, id);
    }

  });

  socket.on('drawRequest', (data, callback) => {

    const code = data.code;
    if (!rooms[code] || rooms[code].outPlayers.includes(socket.id)) return;
    const player = rooms[code].players[socket.id];

    player.hold = pop(code);

    log(code, `DRAW         ${nick(rooms, code, socket.id)} drew card [${player.hold}] | deck: ${rooms[code].deck.length} left`);
    callback(player.hold);
    everyone('draw', { id: socket.id }, code, socket.id);

  });

  socket.on('moveRequest', (data) => {

    everyone('move', { x: data.x, y: data.y }, data.code, socket.id);

  });

  socket.on('playRequest', (data) => {

    const code = data.code;
    const room = rooms[code];
    if (!room || room.outPlayers.includes(socket.id)) return;
    const players = room.players;
    const player = players[socket.id];
    const ids = Object.keys(players);
    const card = player.hold;

    room.play.push({
      key: card,
      id: socket.id
    });

    player.hold = null;

    log(code, `PLAY         ${nick(rooms, code, socket.id)} played card [${card}] to discard`);
    everyone('play', { card }, code, socket.id);

    if (card <= 4) {
      for (const id of ids) {
        if (id !== socket.id && !room.outPlayers.includes(id) && handLength(code, id) == card) {
          log(code, `PENALTY      ${nick(rooms, code, id)} has ${card} cards (matches played value) → +1 card`);
          deal(code, id);
        }
      }
    }
  });

  socket.on('swapRequest', async (data, callback) => {

    const code = data.code;
    const i = data.i;
    const j = data.j;
    const room = rooms[code];
    if (!room || room.outPlayers.includes(socket.id)) return;
    const players = room.players;
    const player = players[socket.id];
    const hand = player.hand;
    const card = hand[i][j];

    room.play.push({
      key: card,
      id: socket.id
    });

    hand[i][j] = player.hold;
    player.hold = null;

    log(code, `SWAP         ${nick(rooms, code, socket.id)} swapped held card into hand[${i}][${j}], discarded [${card}]`);
    callback(card);
    everyone('swap', { id: socket.id, card, i, j }, code, socket.id);

    if (card == 11) {
      log(code, `PENALTY      ${nick(rooms, code, socket.id)} swapped a CAT [11] into hand → +3 cards`);
      for (let i = 0; i < 3; i++) {
        await sleep(200);
        deal(code, socket.id);
      }
    }

  });

  socket.on('copyRequest', async (data, callback) => {

    const code = data.code;
    const id = data.id;
    const i = data.i;
    const j = data.j;
    const room = rooms[code];
    if (!room) return;
    if (room.outPlayers.includes(socket.id)) return;
    if (room.outPlayers.includes(id)) return;
    const play = room.play;

    const card = room.players[id].hand[i].splice(j, 1)[0];
    const prevTop = play[play.length - 1];
    // A normal (non-CAT) copy is only legal if the current discard top matches
    // AND it is not itself already a successful copy. This prevents multiple
    // players from all copying the same rank in a row: only the first copy on
    // top of a freshly-thrown card counts; any subsequent copy on top of that
    // one is illegal. If an illegal copy is played, its entry is NOT marked as
    // a copy, so the next matching card played on top of it can be legal again.
    const isLegalNormalCopy = card !== 11 && prevTop && card === prevTop.key && !prevTop.isCopy;

    play.push({
      key: card,
      id: socket.id,
      isCopy: isLegalNormalCopy
    });

    const copierNick = nick(rooms, code, socket.id);
    const targetNick = nick(rooms, code, id);
    const topCard = prevTop;
    const correct = card === 11
      ? (topCard && card === topCard.key) // CAT: logged as before; actual penalty logic below
      : isLegalNormalCopy;

    log(code, `COPY         ${copierNick} copied ${targetNick}'s hand[${i}][${j}] = [${card}] | discard top was [${topCard ? topCard.key : 'none'}]${topCard && topCard.isCopy ? ' (already a copy)' : ''} | ${correct ? 'CORRECT' : 'WRONG'}`);
    callback(card);
    everyone('copy', { id, card, i, j }, code, socket.id);

    const len = play.length;
    const top = play[len - 2];
    const bottom = play[len - 3];

    // Si no és un gat:
    if (card !== 11) {
      // Si t'has equivocat, penca 2:
      if (!isLegalNormalCopy) {
        log(code, `PENALTY      ${copierNick} wrong copy → +2 cards`);
        for (let i = 0; i < 2; i++) {
          await sleep(200);
          deal(code, socket.id);
        }
        // Si no t'has equivocat i la carta és d'un altre, l'altre penca 2:
      } else if (id !== socket.id) {
        log(code, `PENALTY      ${targetNick} had card correctly copied → +2 cards`);
        for (let i = 0; i < 2; i++) {
          await sleep(200);
          deal(code, id);
        }
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
      //    socket.id must differ from top.id and bottom.id.
      //  - Rule "no dobles con gatos" is enforced upstream: isCopy is never
      //    set to true for a CAT, so a CAT can never be part of a doble.
      // Si t'has equivocat, penca 3:
      if (!top || !bottom || !top.isCopy || top.id == socket.id || bottom.id == socket.id) {
        log(code, `PENALTY      ${copierNick} wrong CAT copy → +3 cards`);
        for (let i = 0; i < 3; i++) {
          await sleep(200);
          deal(code, socket.id);
        }
        // Si no t'has equivocat i la carta és d'un altre, l'altre penca 3:
      } else if (id !== socket.id) {
        log(code, `PENALTY      ${targetNick} had CAT correctly copied → +3 cards`);
        for (let i = 0; i < 3; i++) {
          await sleep(200);
          deal(code, id);
        }
      } else {
        log(code, `COPY OK      ${copierNick} copied own CAT correctly, no penalty`);
      }
    }

    // If the copied player ran out of cards, mark them out.
    if (handLength(code, id) === 0) {
      enterLastRound(code, id);
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

  });

  socket.on('peekRequest', (data, callback) => {

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
    const cardVal = players[id].hand[i][j];
    const phase = room.state == 1 ? 'peek phase' : 'gameplay';

    log(code, `PEEK         ${nick(rooms, code, socket.id)} peeked ${nick(rooms, code, id)}'s hand[${i}][${j}] = [${cardVal}] (${phase})`);
    callback(cardVal);
    everyone('peek', { peekerId: socket.id, peekedId: id, peekedI: i, peekedJ: j }, code, socket.id);

    // Peek phase
    if (room.state == 1) {

      room.peeks += 1
      log(code, `PEEK PHASE   ${room.peeks}/${2 * ids.length} peeks done`);

      if (room.peeks == 2 * ids.length) {
        delete room.peeks
        room.state = 2;
        log(code, `GAMEPLAY     all players peeked — starting turn 1 round 1`);
        everyone('turnStart', { id: ids[room.count.turn], turn: room.count.turn, round: room.count.round }, code);
      }

    }

  });

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

        delete players[socket.id];

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

  socket.on('tradeRequest', (data) => {

    const code = data.code;
    const traderId = data.traderId;
    const tradedId = data.tradedId;
    const traderI = data.traderI;
    const tradedI = data.tradedI;
    const traderJ = data.traderJ;
    const tradedJ = data.tradedJ;
    if (!rooms[code]) return;
    if (rooms[code].outPlayers.includes(traderId)) return;
    if (rooms[code].outPlayers.includes(tradedId)) return;
    const players = rooms[code].players;
    const traderHand = players[traderId].hand;
    const tradedHand = players[tradedId].hand;

    log(code, `TRADE        ${nick(rooms, code, traderId)} hand[${traderI}][${traderJ}] ↔ ${nick(rooms, code, tradedId)} hand[${tradedI}][${tradedJ}]`);

    const temp = traderHand[traderI][traderJ];
    traderHand[traderI][traderJ] = tradedHand[tradedI][tradedJ];
    tradedHand[tradedI][tradedJ] = temp;

    everyone('trade', { traderId, tradedId, traderI, traderJ, tradedI, tradedJ }, code, socket.id)

  });

  socket.on('standRequest', (data) => {

    const code = data.code;
    const room = rooms[code];
    if (!room || !room.standEnabled) return;
    if (room.outPlayers.includes(socket.id)) return;

    const activeId = Object.keys(room.players)[room.count.turn];
    if (socket.id !== activeId) return;

    const player = room.players[socket.id];
    if (player.hold !== null && player.hold !== undefined) return;

    log(code, `STAND        ${nick(rooms, code, socket.id)} chose to stand`);

    enterLastRound(code, socket.id);

    if (rooms[code]) {
      log(code, `AUTO END     ${nick(rooms, code, socket.id)} stood on own turn → advancing turn`);
      advanceTurn(code, socket.id);
    }

  });

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

  const reshuffled = play.slice(0, play.length - 2).map(card => card.key);
  room.deck = shuffle(reshuffled);

  // Trim the play pile to match what the client keeps (last 2 cards),
  // so server and client deck sizes stay in sync on subsequent reshuffles.
  room.play = play.slice(play.length - 2);

  const deck = room.deck;
  let len = deck.length;
  let catsRemoved = 0;
  for (let i = 0; i < len; i++) {
    if (deck[i] == 11) {
      room.cats += 1;
      deck.splice(i, 1);
      i--;
      len--;
      catsRemoved++;
    }
  }

  room.count.deck++;
  log(code, `RESHUFFLE    deck #${room.count.deck} | ${deck.length} cards (${catsRemoved} cats removed, total cats out: ${room.cats})`);

  if (!room.firstReshuffleHappened) {
    room.firstReshuffleHappened = true;
    room.firstReshuffleRound = room.count.round;
    log(code, `FIRST RESH   stand will enable on round ${room.firstReshuffleRound + 2}`);
  }

}

function enterLastRound(code, outId) {

  const room = rooms[code];
  if (!room) return;

  // Idempotent: a given player is only recorded as out once.
  if (room.outPlayers.includes(outId)) return;

  room.outPlayers.push(outId);

  if (room.state < 3) {
    room.state = 3;
    room.lastRoundNum = room.count.round + 1;
    log(code, `LAST ROUND   ${nick(rooms, code, outId)} went out | game ends after round ${room.lastRoundNum + 1}`);
  } else {
    log(code, `OUT          ${nick(rooms, code, outId)} went out (last round already active)`);
  }

  everyone('lastRound', { eliminatedId: outId, lastRoundNum: room.lastRoundNum }, code);

}

function advanceTurn(code, endingId) {

  const room = rooms[code];
  if (!room) return;

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

  if (room.firstReshuffleHappened && !room.standEnabled && room.count.round > room.firstReshuffleRound) {
    room.standEnabled = true;
    log(code, `STAND ENABLE round ${room.count.round + 1} — players may now stand`);
    everyone('standEnable', {}, code);
  }

  const allOut = ids.every(id => eliminated.includes(id));

  if (room.state === 3 && (allOut || nextRound > room.lastRoundNum)) {
    log(code, `GAME OVER    ${allOut ? 'all players stood' : `end of round ${room.lastRoundNum + 1}`}`);

    // Compute game scores and accumulate into player.points
    const playersWithCats = Object.values(room.players)
      .filter(p => p.hand.flat().includes(11)).length;

    const gameScores = {};
    for (const [id, p] of Object.entries(room.players)) {
      const cards = p.hand.flat();
      const cats = cards.filter(v => v === 11).length;
      const nonCatSum = cards.filter(v => v !== 11).reduce((sum, v) => sum + v, 0);

      const catScore = playersWithCats > 1
        ? cats * 10
        : (cats > 0 ? -10 + (cats - 1) * 10 : 0);

      const score = nonCatSum + catScore;
      const before = p.points ?? 0;
      p.points = before + score;
      gameScores[id] = score;
      log(code, `SCORE        ${nick(rooms, code, id)} hand=${JSON.stringify(p.hand)} cats=${cats} catScore=${catScore} score=${score} before=${before} total=${p.points}`);
    }

    everyone('gameEnd', {
      players: Object.fromEntries(
        Object.entries(room.players).map(([id, p]) => [id, {
          nick: p.nick,
          hand: p.hand,
          color: p.color,
          points: p.points,
          leader: p.leader,
          score: gameScores[id]
        }])
      )
    }, code);

    // Reset room to lobby state for rematch
    room.state = 0;
    room.count = { turn: 0, round: 0, deck: 0 };
    room.outPlayers = [];
    room.cats = 0;
    delete room.lastRoundNum;
    room.firstReshuffleHappened = false;
    room.firstReshuffleRound = null;
    room.standEnabled = false;
    for (const p of Object.values(room.players)) {
      p.hand = [[], []];
      p.hold = null;
      p.ready = false;
    }

    log(code, `ROOM RESET   back to lobby`);
    everyone('playerUpdate', { players: room.players }, code);
    return;
  }

  const nextNick = nick(rooms, code, ids[nextTurn]);
  log(code, `TURN END     ${endingNick} → next: ${nextNick} (turn ${nextTurn + 1}, round ${nextRound + 1})`);
  everyone('turnStart', { id: ids[nextTurn], turn: nextTurn, round: nextRound }, code);

}

function deal(code, id) {

  if (!rooms[code]) return;

  if (handLength(code, id) == 14) {
    log(code, `DEAL SKIP    ${nick(rooms, code, id)} already has 14 cards`);
    return;
  }

  const room = rooms[code];
  const players = room.players;
  const player = players[id];
  const hand = player.hand;

  const card = pop(code);

  let line = 0;
  let min = -1;
  for (let i = 0; i < 2; i++) {
    if (min == -1 || min > hand[i].length) {
      min = hand[i].length;
      line = i;
    }
  }

  hand[line].push(card);

  log(code, `DEAL         [${card}] → ${nick(rooms, code, id)} row ${line} (hand: ${JSON.stringify(hand.map(r => r.length))})`);
  everyone('deal', { id, line }, code);

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