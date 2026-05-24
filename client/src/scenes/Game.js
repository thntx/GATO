import { Button } from '../objects/Button.js'
import { DeckStack } from '../objects/DeckStack.js'
import { PlayStack } from '../objects/PlayStack.js'
import { HandStack } from '../objects/HandStack.js'
import { Log } from '../objects/Log.js'
import { ColorReplacePipeline } from '../objects/ColorReplacePipeline.js'
import { pos, uiConfig, playConfig, cardConfig, handConfig, TEXT_RESOLUTION, SOUND_MS } from '../objects/Config.js'

export class Game extends Phaser.Scene {

    constructor() {
        super('Game');
    }

    init(data) {
        this.socket = data.socket;
        this.code = data.code;
        this.players = data.players;
    }

    preload() {
        this.load.spritesheet('cards', 'assets/spritesheet.png', {frameWidth: cardConfig.SIZE, frameHeight: cardConfig.SIZE});
        this.load.audio('sixSeven', 'assets/sounds/six_seven.mp3');
        // Per-action sounds with you/other variants. Keys are camelCase to match
        // the playActionSound helper's lookup. Files are <action>.wav under
        // assets/sounds/, with a you_ / other_ prefix per actor relationship.
        for (const action of ['copy', 'fail', 'peek', 'unpeek', 'trade', 'turn', 'take', 'play', 'hand', 'get']) {
            const cap = action.charAt(0).toUpperCase() + action.slice(1);
            this.load.audio('you' + cap, `assets/sounds/you_${action}.wav`);
            this.load.audio('other' + cap, `assets/sounds/other_${action}.wav`);
        }
        this.load.audio('show', 'assets/sounds/show.wav');
        this.load.audio('gameOver', 'assets/sounds/game_over.wav');
    }

    // Play a per-action sound, picking the you_/other_ variant based on whether
    // the actor is the local player. Called from socket handlers and local
    // emits so the UX is consistent regardless of who triggered the action.
    playActionSound(action, actorId) {
        if (!this.sound || !this.cache || !this.cache.audio) return;
        const isYou = actorId === this.socket.id;
        const key = (isYou ? 'you' : 'other') + action.charAt(0).toUpperCase() + action.slice(1);
        if (this.cache.audio.has(key)) this.sound.play(key);
    }

    // Play a sound by exact key (no you/other distinction).
    playSound(name) {
        if (!this.sound || !this.cache || !this.cache.audio) return;
        if (this.cache.audio.has(name)) this.sound.play(name);
    }

    // Lock the actor's UI for a span of ms — used right after the local
    // player emits a request, so they can't fire a follow-up action before
    // the corresponding sound has played out. Pointerdown handlers and
    // button callbacks early-return when this.frozen is true. The server
    // independently sleeps for the same span between events, so by the time
    // the freeze ends the next event has already arrived (or is about to).
    //
    // Cumulative: if a callback learns that the consequences of the action
    // are longer than first assumed (e.g. a CAT was just displaced and +3
    // take sounds are about to arrive), it can call freeze() again to extend
    // the expiry. A single timer tracks the latest expiry — older approach
    // scheduled one delayedCall per call and used a `time.now >= expiry - 5`
    // guard to skip clearing on stale fires, which could leave `frozen`
    // stuck true if the latest callback ran a couple ms early (tab-throttle
    // catchup, paused scene, sub-frame timing) and no further freeze ever
    // scheduled a replacement timer.
    freeze(ms) {
        const expiry = this.time.now + ms;
        this.freezeExpiry = Math.max(this.freezeExpiry || 0, expiry);
        this.frozen = true;
        if (this.freezeTimer) {
            this.freezeTimer.remove(false);
            this.freezeTimer = null;
        }
        const delay = Math.max(0, this.freezeExpiry - this.time.now);
        this.freezeTimer = this.time.delayedCall(delay, () => {
            this.freezeTimer = null;
            this.freezeExpiry = 0;
            this.frozen = false;
        });
    }

    // Safety net: any turn boundary should mean previous freezes are
    // irrelevant (the actor's sound has long since played, or it's a new
    // actor whose freeze hasn't started yet). Forcibly clear so a stuck
    // freeze can never outlive a turn change.
    clearFreeze() {
        if (this.freezeTimer) {
            this.freezeTimer.remove(false);
            this.freezeTimer = null;
        }
        this.freezeExpiry = 0;
        this.frozen = false;
    }

    create() {

        // Register the color-replace PostFX. Phaser's setPostPipeline(class)
        // silently no-ops unless the class is in postPipelineClasses first.
        const pipelines = this.game.renderer && this.game.renderer.pipelines;
        if (pipelines && !pipelines.postPipelineClasses.has('ColorReplacePipeline')) {
            pipelines.addPostPipeline('ColorReplacePipeline', ColorReplacePipeline);
        }

        this.turn = new Button(this, pos.X(7), pos.Y(82), pos.X(10), pos.Y(5), uiConfig.COLOR, 'Turn 1', pos.Y(3), 'bold', 'white');
        this.round = new Button(this, pos.X(7), pos.Y(88), pos.X(10), pos.Y(5), uiConfig.COLOR, 'Round 1', pos.Y(3), 'bold', 'white');
        this.deck = new Button(this, pos.X(7), pos.Y(94), pos.X(10), pos.Y(5), uiConfig.COLOR, 'Deck 1', pos.Y(3), 'bold', 'white');

        // Aliens sit at HAND_Y_CENTER in 2- and 3-player games (the first two
        // rows of handConfig.Y put every non-self player at the same center y).
        // In those layouts the playstack reads better when it's vertically
        // aligned with the middle of the alien card rows rather than below
        // them. With 3-4 aliens the layout fans them around the screen, so
        // fall back to the default playConfig.Y to leave room for the deck.
        const alienCount = Object.keys(this.players).length - 1;
        const playY = alienCount <= 2 ? handConfig.Y[alienCount - 1][1] : playConfig.Y;

        // Frozen-UI flag for the actor: true while the local player's last
        // emitted action's sound is still playing. Pointerdown handlers and
        // button callbacks early-return on this so the actor can't queue the
        // next request before the previous sound finishes — keeps the
        // sound/event ordering aligned with the server's sleep-paced emits.
        this.frozen = false;

        this.skip = new Button(this, playConfig.X, playY + pos.Y(10), cardConfig.SIZE * cardConfig.SCALE, pos.Y(5), uiConfig.COLOR, 'SKIP', pos.Y(3), 'bold', 'white', () => {
            if (this.frozen) return;
            this.myTurn = false;
            this.socket.emit('turnEnd', { code: this.code });
            this.skip.setVisible(false);
        }).setVisible(false);

        // STAND sits directly above the turn indicator (turn is at pos.Y(82),
        // stand at pos.Y(76)) so it groups with the round/deck stack on the
        // left and frees up the right side for the action log.
        this.stand = new Button(this, pos.X(7), pos.Y(76), pos.X(10), pos.Y(5), uiConfig.COLOR, 'STAND', pos.Y(3), 'bold', 'white', () => {
            if (this.frozen) return;
            this.socket.emit('standRequest', { code: this.code });
            this.stand.setVisible(false);
        }).setVisible(false);

        this.deckStack = new DeckStack(this);

        this.playStack = new PlayStack(this, playConfig.X, playY);
        
        this.handStacks = {};

        const ids = Object.keys(this.players);
        const len = ids.length;
        const idx = ids.indexOf(this.socket.id);
        for(let i = 0; i < len; i ++) {
            const id = ids[(idx + i) % len];
            this.handStacks[id] = new HandStack(this, id, i, len - 2);
        }

        this.handStack = this.handStacks[this.socket.id];

        // Action log — fixed bottom-right viewport, scrollable, never trims
        // entries. Width is 4/5 of the original sizing; height is computed
        // from the row stride so exactly 6 rows fit before the top edge cuts
        // older entries off.
        const logW = pos.X(20);
        const logH = Log.heightForRows(6);
        this.log = new Log(this, pos.X(99) - logW, pos.Y(99) - logH, logW, logH);

        this.copy = false;
        this.peeks = { self: 2, alien: 0 };
        this.peekedCards = [];
        this.trade = false;
        this.peekTrade = false;
        this.waitingPeek = false;
        this.waitingTrade = false;
        this.outPlayers = [];
        this.standEnabled = false;

        this.peekPhase = true;
        this.peekCounts = {};
        for (const stackId of Object.keys(this.handStacks)) {
            this.handStacks[stackId].setActive(true);
            this.peekCounts[stackId] = 0;
        }

        this.socket.emit('clientReady', { code: this.code });

        this.socket.on('turnStart', (data) => {

            const id = data.id
            const turn = data.turn;
            const round = data.round;

            // A turn boundary should always release any leftover freeze — by
            // now the previous actor's sounds have played and the next actor
            // is either us (clean slate) or someone else (we shouldn't be
            // frozen at all).
            this.clearFreeze();

            this.turn.setText('Turn ' + (turn + 1));
            this.round.setText('Round ' + (round + 1));

            this.turnId = id;
            this.myTurn = id == this.socket.id;

            this.peekPhase = false;

            for (const stackId of Object.keys(this.handStacks)) {
                this.handStacks[stackId].setActive(stackId === id);
            }

            this.copy = true;
            this.peeks = { self: 0, alien: 0 };
            this.peekedCards = [];
            this.trade = false;
            this.peekTrade = false;
            this.waitingPeek = false;
            this.waitingTrade = false;

            this.stand.setVisible(this.standEnabled && this.myTurn && !this.outPlayers.includes(this.socket.id));

            this.playActionSound('turn', id);

        });

        this.socket.on('deal', (data) => {

            const id = data.id;
            const line = data.line;

            this.handStacks[id].draw(line);
            // Initial 4-card deal at game start (still in peek phase) uses
            // the dedicated "get" sound; deals during gameplay (penalty
            // cards from 0-4 plays, wrong copies, CAT swaps) use "take".
            this.playActionSound(this.peekPhase ? 'get' : 'take', id);

        });

        this.socket.on('peek', (data) => {

            const peekerId = data.peekerId;
            const peekedId = data.peekedId;
            const peekedI = data.peekedI;
            const peekedJ = data.peekedJ;

            const peekedCard = this.handStacks[peekedId].get(peekedI, peekedJ);
            this.handStacks[peekedId].highlight(peekedI, peekedJ, this.players[peekerId].color);

            this.recordPeek(peekerId);

            this.playActionSound('peek', peekerId);
            // Highlight (yoyo, 1000ms each way) ends ~2000ms after peek; play
            // the unpeek sound at 1000ms, halfway through, when the visual
            // starts fading back to neutral. Skip the sound if the card has
            // since moved off the hand (copied/swapped to the playstack)
            // because there's no longer an unpeek visual to accompany.
            this.time.delayedCall(1000, () => {
                if (peekedCard && peekedCard.type === 'hand') {
                    this.playActionSound('unpeek', peekerId);
                }
            });

        });

        this.socket.on('draw', (data) => {

            const id = data.id;

            this.deckStack.alienDraw(id);
            this.playActionSound('hand', id);

        });

        this.socket.on('move', (data) => {

            // card.setPosition(data.x, data.y);

        });

        this.socket.on('trade', (data) => {

            const traderId = data.traderId;
            const tradedId = data.tradedId;
            const traderI = data.traderI;
            const tradedI = data.tradedI;
            const traderJ = data.traderJ;
            const tradedJ = data.tradedJ;
            const actorId = data.actorId;

            const traderCard = this.handStacks[traderId].get(traderI, traderJ);
            const tradedCard = this.handStacks[tradedId].get(tradedI, tradedJ);
            // Cancel any local drag on either card before swapping — otherwise
            // the cursor-tracking drag handler fights the order() tween that
            // moves the card into its new hand slot.
            traderCard.cancelDrag();
            tradedCard.cancelDrag();
            this.handStacks[traderId].swap(tradedCard, traderI, traderJ, 400);
            this.handStacks[tradedId].swap(traderCard, tradedI, tradedJ, 400);

            this.playActionSound('trade', actorId);

        });

        this.socket.on('play', (data) => {

            const card = data.card;
            const actorId = data.actorId;

            this.playStack.alienPlay(card);
            this.playActionSound('play', actorId);

        });

        this.socket.on('swap', (data) => {

            const id = data.id;
            const card = data.card;
            const i = data.i;
            const j = data.j;

            this.handStacks[id].alienSwap(card, i, j);
            // Swap discards a card to the playstack, same as a play. Reuse
            // the play sound (no separate "swap" sound exists), keyed on the
            // swapper as the actor.
            this.playActionSound('play', id);

        });

        this.socket.on('copy', (data) => {

            const id = data.id;
            const card = data.card;
            const i = data.i;
            const j = data.j;
            const copierId = data.copierId;
            const success = data.success;

            this.handStacks[id].alienCopy(card, i, j, copierId);
            this.playActionSound(success ? 'copy' : 'fail', copierId);

        });

        this.socket.on('sound', (data) => {
            if (data && data.name && this.cache.audio.has(data.name)) {
                this.sound.play(data.name);
            }
        });

        this.socket.on('logEntry', (data) => {
            if (!this.log || !data || !data.segments) return;
            this.log.addEntry(data.segments, data.color);
        });

        this.socket.on('reshuffle', (data) => {

            const count = data.deck;

            this.deck.setText('Deck ' + count);

            this.playStack.reshuffle();

        });

        this.socket.on('standEnable', () => {
            this.standEnabled = true;
            if (this.myTurn && !this.outPlayers.includes(this.socket.id) && !this.deckStack.holdCard) {
                this.stand.setVisible(true);
            }
        });

        this.socket.on('lastRound', (data) => {

            const eliminatedId = data.eliminatedId;
            this.outPlayers.push(eliminatedId);

            if (this.handStacks[eliminatedId]) {
                this.handStacks[eliminatedId].setOut();
            }

            const isMe = eliminatedId === this.socket.id;

            if (isMe) {
                this.stand.setVisible(false);
            }

            if (isMe && this.skip.visible) {
                this.myTurn = false;
                this.socket.emit('turnEnd', { code: this.code });
                this.skip.setVisible(false);
            }

            // The "<player> stood" / "<player> ran out of cards" line in the
            // action log replaces the old centered popup notice — same info
            // without the modal.

        });

        this.socket.on('gameEnd', (data) => {

            // Merge updated points and leader back into local players
            for (const [id, p] of Object.entries(data.players)) {
                if (this.players[id]) {
                    this.players[id].points = p.points ?? 0;
                    this.players[id].leader = p.leader;
                }
            }

            this.showGameOver(data.players);

        });

        // After gameEnd the server resets the room and emits playerUpdate.
        // Capture it here so "Back to Room" always passes fresh lobby players.
        this.socket.on('playerUpdate', (data) => {
            this.players = data.players;
        });

        // If the leader starts a new game while this client is still showing
        // Game Over (i.e. they never pressed "Back to Room"), the server emits
        // 'start' but this scene isn't listening via Lobby. Without this
        // handler, clientReady never fires and the new game stalls forever for
        // everyone. Restart the Game scene directly with the latest players.
        this.socket.on('start', () => {
            this.scene.start('Game', { socket: this.socket, code: this.code, players: this.players });
        });

        this.events.on('shutdown', () => {
            this.socket.off('turnStart');
            this.socket.off('deal');
            this.socket.off('peek');
            this.socket.off('draw');
            this.socket.off('move');
            this.socket.off('trade');
            this.socket.off('play');
            this.socket.off('swap');
            this.socket.off('copy');
            this.socket.off('reshuffle');
            this.socket.off('sound');
            this.socket.off('logEntry');
            this.socket.off('standEnable');
            this.socket.off('lastRound');
            this.socket.off('gameEnd');
            this.socket.off('playerUpdate');
            this.socket.off('start');
        });
    }

    recordPeek(peekerId) {
        if (!this.peekPhase) return;
        this.peekCounts[peekerId] = (this.peekCounts[peekerId] || 0) + 1;
        if (this.peekCounts[peekerId] >= 2 && this.handStacks[peekerId]) {
            this.handStacks[peekerId].setActive(false);
        }
    }

    showGameOver(playersData) {

        // Staggered reveal: server turn order, so every client sees the same sequence
        const orderedIds = Object.keys(playersData);

        let delay = 500;
        const delayPerCard = 300;
        const pauseBetweenPlayers = 400;

        for (const id of orderedIds) {
            if (playersData[id] && this.handStacks[id]) {
                delay = this.handStacks[id].reveal(playersData[id].hand, delay, delayPerCard);
                delay += pauseBetweenPlayers;
            }
        }

        this.time.delayedCall(delay, () => {

            // Overlay
            this.add.rectangle(pos.X(50), pos.Y(50), pos.X(100), pos.Y(100), 0x000000, 0.75).setDepth(30);

            this.playSound('gameOver');

            // Title — slightly shorter than before so the result strip can
            // start higher and clear the Go-to buttons even at 7 players.
            new Button(this, pos.X(50), pos.Y(10), pos.X(35), pos.Y(10), uiConfig.COLOR, 'GAME OVER', pos.Y(6), 'bold', 'white').setDepth(31);

            // Player results sorted by this game's score (lowest wins).
            // Use the server-computed score so CATs are valued correctly
            // (+10 each if multiple players hold CATs, -10 for the first and
            // +10 for each additional if only one player holds CATs).
            // Tiebreaker on equal score: a player who ran out of cards
            // ('empty') outranks a player who stood ('stand'); anyone else
            // (didn't go out) ranks last. Players tied on both score and
            // out-bucket all share the trophy.
            // Tiebreak order: score asc → hand size asc (fewer cards left
            // beats more) → outBy ('empty' > 'stand' > didn't go out). Hand
            // size already separates an emptied player (0 cards) from a
            // stander, so outBy only kicks in when both scores AND hand
            // sizes match.
            const order = (r) => r.outBy === 'empty' ? 0 : r.outBy === 'stand' ? 1 : 2;
            const compare = (a, b) => {
                if (a.score !== b.score) return a.score - b.score;
                if (a.handSize !== b.handSize) return a.handSize - b.handSize;
                return order(a) - order(b);
            };
            const results = Object.entries(playersData).map(([id, p]) => ({
                id,
                nick: p.nick,
                color: p.color,
                score: p.score ?? p.hand.flat().reduce((sum, v) => sum + v, 0),
                handSize: p.hand.flat().length,
                total: p.points ?? 0,
                outBy: p.outBy
            })).sort(compare);

            // Standard competition ranking: tied players share the lower rank
            // and the next distinct row jumps by the number tied. Tied iff
            // compare returns 0 — same keys (score, hand size, out-bucket)
            // used by the sort.
            let rank = 1;
            for (let i = 0; i < results.length; i++) {
                if (i > 0 && compare(results[i - 1], results[i]) !== 0) {
                    rank = i + 1;
                }
                results[i].rank = rank;
            }

            const top = results[0];
            const isWinner = (r) => compare(r, top) === 0;

            // Each result row is three equal-sized bubbles (name, round
            // points, total points) plus a small position bubble on the
            // left. Separated by the same pixel gap that sits between rows
            // so spacings read uniformly. Sized to always fit a 7-player
            // game above the Go-to buttons at pos.Y(80) — the start y is
            // high enough that even seven rows clear them.
            const rowH = pos.Y(7);
            const margin = pos.Y(1);
            const rowStride = rowH + margin;
            const rowFont = pos.Y(3.5);
            const totalW = pos.X(44);
            const bubbleW = (totalW - 2 * margin) / 3;
            const sideOffset = bubbleW + margin;
            const sideW = pos.X(4);
            const posX = pos.X(50) - sideOffset - bubbleW / 2 - margin - sideW / 2;
            const catX = pos.X(50) + sideOffset + bubbleW / 2 + margin + sideW / 2;
            const startY = pos.Y(20);
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const winner = isWinner(r);
                const style = winner ? 'bold' : '';
                const y = startY + i * rowStride;
                new Button(this, posX, y, sideW, rowH, r.color, r.rank + '.', rowFont, style, 'white').setDepth(31);
                new Button(this, pos.X(50) - sideOffset, y, bubbleW, rowH, r.color, r.nick, rowFont, style, 'white').setDepth(31);
                new Button(this, pos.X(50), y, bubbleW, rowH, r.color, r.score + ' Points', rowFont, style, 'white').setDepth(31);
                new Button(this, pos.X(50) + sideOffset, y, bubbleW, rowH, r.color, r.total + ' Total', rowFont, style, 'white').setDepth(31);
                if (winner) {
                    new Button(this, catX, y, sideW, rowH, r.color, '😺', rowFont, style, 'white').setDepth(31);
                }
            }

            // Go to menu — left, mirroring Lobby's "Leave Room" position so
            // the exit-from-room action sits in the same place across scenes.
            new Button(this, pos.X(38), pos.Y(80), pos.X(20), pos.Y(10), uiConfig.COLOR, 'Go to Menu', pos.Y(5), 'bold', 'white', () => {
                this.socket.disconnect();
                this.scene.start('Menu');
            }).setDepth(31);

            // Go to room — right, mirroring Lobby's "Start Game" position so
            // the continue-into-lobby action sits in the same place across scenes.
            new Button(this, pos.X(62), pos.Y(80), pos.X(20), pos.Y(10), uiConfig.COLOR, 'Go to Room', pos.Y(5), 'bold', 'white', () => {
                this.scene.start('Lobby', { socket: this.socket, code: this.code, players: this.players });
            }).setDepth(31);

        });

    }

    update() {
    }
}