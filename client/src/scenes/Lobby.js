import { Button } from '../objects/Button.js'
import { pos, uiConfig, deckConfig, handConfig } from '../objects/Config.js'

export class Lobby extends Phaser.Scene {

    constructor() {
        super('Lobby');
    }

    init(data) {
        this.socket = data.socket;
        this.code = data.code;
        this.players = data.players
    }

    preload() {
    }

    create() {

        this.socket.on('playerUpdate', (data) => {
            this.players = data.players;
            this.setLeader();
            this.updatePlayerList();
            this.checkEnableStart();
        });

        this.socket.on('leave', () => {
            this.scene.start('Menu');
        });

        this.socket.on('start', () => {
            this.scene.start('Game', { socket: this.socket, code: this.code, players: this.players });
        });

        // Ask server for the current player list. Handles the race window
        // where playerUpdate events fired between scene transitions were dropped.
        this.socket.emit('lobbyRequest', { code: this.code });

        this.setLeader();

        this.playerList = this.createPlayerList();
        
        this.leave = new Button(this, pos.X(38), pos.Y(80), pos.X(20), pos.Y(10), uiConfig.COLOR, 'Leave Room', pos.Y(5), 'bold', 'white', () => {
            this.socket.emit('leaveRequest', { code: this.code, id: this.socket.id });
        });

        this.start = new Button(this, pos.X(62), pos.Y(80), pos.X(20), pos.Y(10), uiConfig.COLOR, 'Start Game', pos.Y(5), 'bold', 'white', () => {
            this.socket.emit('startRequest', { code: this.code } );
        });
        this.checkEnableStart();

        this.events.on('shutdown', () => {
            this.socket.off('playerUpdate');
            this.socket.off('leave');
            this.socket.off('start');
        });
    }

    update() {
    }

    setLeader() {
        this.leader = this.players[this.socket.id].leader;
    }

    createPlayerList() {
        const ids = Object.keys(this.players);
        const list = this.add.container(pos.X(50), pos.Y(20));
        // Always use the compact sizing so the layout stays stable when a
        // 6th or 7th player joins (no jump from the looser 2–5 sizing). The
        // horizontal gap between the three bubbles is set to the same pixel
        // value as the vertical gap between rows so spacings read uniformly.
        const rowH = pos.Y(7);
        const margin = pos.Y(1);
        const rowStride = rowH + margin;
        const fontSize = pos.Y(3.5);
        const rankW = pos.X(10);
        const labelW = pos.X(20);
        const pointsW = pos.X(10);
        const sideOffset = labelW / 2 + margin + rankW / 2;
        for (let i = 0; i < ids.length; i ++) {
            const id = ids[i];
            const player = this.players[id];
            const y = rowStride * i;
            const rank = new Button(this, -sideOffset, y, rankW, rowH, player.color, player.leader ? '😺' : '🐭', fontSize, '', 'white', id != this.socket.id && this.leader ? () => {
                this.socket.emit('promoteRequest', { code: this.code, id: id });
            } : null);
            const label = new Button(this, 0, y, labelW, rowH, player.color, player.nick, fontSize, '', 'white', id != this.socket.id && this.leader ? () => {
                this.socket.emit('leaveRequest', { code: this.code, id: id });
            } : null );
            const points = new Button(this, sideOffset, y, pointsW, rowH, player.color, (player.points ?? 0) + 'p', fontSize, '', 'white');
            list.add([rank, label, points]);
        }
        return list;
    }

    updatePlayerList() {
        this.playerList.destroy(true);
        this.playerList = this.createPlayerList();
    }

    checkEnableStart() {
        this.start.enable(Object.keys(this.players).length > 1 && this.leader);
    }
}
