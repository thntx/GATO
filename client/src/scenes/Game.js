import { Button } from '../objects/Button.js'
import { DeckStack } from '../objects/DeckStack.js'
import { PlayStack } from '../objects/PlayStack.js'
import { HandStack } from '../objects/HandStack.js'
import { pos, uiConfig, playConfig, cardConfig, handConfig } from '../objects/Config.js'

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
        this.load.audio('sevenOnSix', 'assets/sounds/seven_on_six.mp3');
    }

    create() {

        this.turn = new Button(this, pos.X(7), pos.Y(82), pos.X(10), pos.Y(5), uiConfig.COLOR, 'Turn 1', pos.Y(3), 'bold', 'white');
        this.round = new Button(this, pos.X(7), pos.Y(88), pos.X(10), pos.Y(5), uiConfig.COLOR, 'Round 1', pos.Y(3), 'bold', 'white');
        this.deck = new Button(this, pos.X(7), pos.Y(94), pos.X(10), pos.Y(5), uiConfig.COLOR, 'Deck 1', pos.Y(3), 'bold', 'white');
        
        this.skip = new Button(this, playConfig.X, playConfig.Y + pos.Y(12), pos.X(10), pos.Y(5), uiConfig.COLOR, 'SKIP', pos.Y(3), 'bold', 'white', () => {
            this.myTurn = false;
            this.socket.emit('turnEnd', { code: this.code });
            this.skip.setVisible(false);
        }).setVisible(false);

        const seventhCardRightEdge = pos.X(50) + (7 * cardConfig.SIZE * cardConfig.SCALE + 6 * handConfig.MARGIN) / 2;
        const standX = (seventhCardRightEdge + pos.X(100)) / 2;
        this.stand = new Button(this, standX, pos.Y(82), pos.X(10), pos.Y(5), uiConfig.COLOR, 'STAND', pos.Y(3), 'bold', 'white', () => {
            this.socket.emit('standRequest', { code: this.code });
            this.stand.setVisible(false);
        }).setVisible(false);

        this.deckStack = new DeckStack(this);

        this.playStack = new PlayStack(this);
        
        this.handStacks = {};

        const ids = Object.keys(this.players);
        const len = ids.length;
        const idx = ids.indexOf(this.socket.id);
        for(let i = 0; i < len; i ++) {
            const id = ids[(idx + i) % len];
            this.handStacks[id] = new HandStack(this, id, i, len - 2);
        }

        this.handStack = this.handStacks[this.socket.id];

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

        });

        this.socket.on('deal', (data) => {

            const id = data.id;
            const line = data.line;

            this.handStacks[id].draw(line);

        });

        this.socket.on('peek', (data) => {

            const peekerId = data.peekerId;
            const peekedId = data.peekedId;
            const peekedI = data.peekedI;
            const peekedJ = data.peekedJ;

            this.handStacks[peekedId].highlight(peekedI, peekedJ, this.players[peekerId].color);

            this.recordPeek(peekerId);

        });

        this.socket.on('draw', (data) => {

            const id = data.id;

            this.deckStack.alienDraw(id);

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

            const temp = this.handStacks[traderId].get(traderI, traderJ);
            this.handStacks[traderId].swap(this.handStacks[tradedId].get(tradedI, tradedJ), traderI, traderJ, 400);
            this.handStacks[tradedId].swap(temp, tradedI, tradedJ, 400);

        });

        this.socket.on('play', (data) => {

            const card = data.card;

            console.log(card);

            this.playStack.alienPlay(card);
            
        });

        this.socket.on('swap', (data) => {

            const id = data.id;
            const card = data.card;
            const i = data.i;
            const j = data.j;

            this.handStacks[id].alienSwap(card, i, j);

        });

        this.socket.on('copy', (data) => {

            const id = data.id;
            const card = data.card;
            const i = data.i;
            const j = data.j;

            this.handStacks[id].alienCopy(card, i, j);

        });

        this.socket.on('sound', (data) => {
            if (data && data.name && this.cache.audio.has(data.name)) {
                this.sound.play(data.name);
            }
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

            const name = this.players[eliminatedId]?.nick || 'A player';
            const msg = isMe ? 'You went out!\nLast Round!' : `${name} went out!\nLast Round!`;

            const notice = this.add.text(pos.X(50), pos.Y(50), msg, {
                fontSize: pos.Y(4) + 'px',
                color: '#ffffff',
                align: 'center',
                backgroundColor: '#000000cc',
                padding: { x: 20, y: 12 }
            }).setOrigin(0.5).setDepth(20);

            this.time.delayedCall(3000, () => { if (notice.active) notice.destroy(); });

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

            // Title
            new Button(this, pos.X(50), pos.Y(12), pos.X(35), pos.Y(12), uiConfig.COLOR, 'GAME OVER', pos.Y(8), 'bold', 'white').setDepth(31);

            // Player results sorted by this game's score (lowest wins).
            // Use the server-computed score so CATs are valued correctly
            // (+10 each if multiple players hold CATs, -10 for the first and
            // +10 for each additional if only one player holds CATs).
            // Tiebreaker on equal score: a player who ran out of cards
            // ('empty') outranks a player who stood ('stand'); anyone else
            // (didn't go out) ranks last. Players tied on both score and
            // out-bucket all share the trophy.
            const order = (r) => r.outBy === 'empty' ? 0 : r.outBy === 'stand' ? 1 : 2;
            const results = Object.entries(playersData).map(([id, p]) => ({
                id,
                nick: p.nick,
                color: p.color,
                score: p.score ?? p.hand.flat().reduce((sum, v) => sum + v, 0),
                total: p.points ?? 0,
                outBy: p.outBy
            })).sort((a, b) => a.score !== b.score ? a.score - b.score : order(a) - order(b));

            const top = results[0];
            const topOrder = order(top);
            const isWinner = (r) => r.score === top.score && order(r) === topOrder;

            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const winner = isWinner(r);
                const label = winner
                    ? `${r.nick}  —  ${r.score} pts  (${r.total} total)  🏆`
                    : `${r.nick}  —  ${r.score} pts  (${r.total} total)`;
                new Button(this, pos.X(50), pos.Y(30) + i * pos.Y(11), pos.X(50), pos.Y(9), r.color, label, pos.Y(4), winner ? 'bold' : '', 'white').setDepth(31);
            }

            // Back to room
            new Button(this, pos.X(35), pos.Y(88), pos.X(22), pos.Y(9), uiConfig.COLOR, 'Back to Room', pos.Y(4), 'bold', 'white', () => {
                this.scene.start('Lobby', { socket: this.socket, code: this.code, players: this.players });
            }).setDepth(31);

            // Back to menu
            new Button(this, pos.X(65), pos.Y(88), pos.X(22), pos.Y(9), uiConfig.COLOR, 'Back to Menu', pos.Y(4), 'bold', 'white', () => {
                this.socket.disconnect();
                this.scene.start('Menu');
            }).setDepth(31);

        });

    }

    update() {
    }
}