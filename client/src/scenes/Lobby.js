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
        for (let i = 0; i < ids.length; i ++) {
            const id = ids[i];
            const player = this.players[id];
            const rank = new Button(this, -pos.X(16), pos.Y(10) * i, pos.X(10), pos.Y(8), player.color, player.leader ? '😺' : '🐭', pos.Y(4), '', 'white', id != this.socket.id && this.leader ? () => {
                this.socket.emit('promoteRequest', { code: this.code, id: id });
            } : null);
            const label = new Button(this, 0, pos.Y(10) * i, pos.X(20), pos.Y(8), player.color, player.nick, pos.Y(4), '', 'white', id != this.socket.id && this.leader ? () => {
                this.socket.emit('leaveRequest', { code: this.code, id: id });
            } : null );
            const points = new Button(this, pos.X(16), pos.Y(10) * i, pos.X(10), pos.Y(8), player.color, (player.points ?? 0) + 'p', pos.Y(4), '', 'white');
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
