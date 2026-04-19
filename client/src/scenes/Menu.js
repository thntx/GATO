import { Button } from '../objects/Button.js'
import { TextInput } from '../objects/TextInput.js'
import { pos, uiConfig } from '../objects/Config.js'

export class Menu extends Phaser.Scene {

    constructor() {
        super('Menu');
    }

    preload() {
    }

    create() {
        // Use localhost when running Vite locally, otherwise let socket.io automatically connect to the public server IP
        const serverUrl = import.meta.env.DEV ? 'http://localhost:8081' : '';
        this.socket = io(serverUrl);

        const title = new Button(this, pos.X(50), pos.Y(25), pos.X(37), pos.Y(25), uiConfig.COLOR, 'GATO', pos.Y(20), 'bold', 'white');

        const code = new TextInput(this, pos.X(50), pos.Y(50), pos.X(20), pos.Y(10), 8, 'Room code',
            'Enter a room code. Anyone can join your room with this code.', pos.Y(5), '#ffffff'
        );

        const nick = new TextInput(this, pos.X(50), pos.Y(65), pos.X(20), pos.Y(10), 8, 'Nickname',
            'Enter your nickname. This will be displayed in the game.', pos.Y(5), '#ffffff'
        );

        const errorText = this.add.text(pos.X(50), pos.Y(90), '', {
            fontSize: pos.Y(3) + 'px',
            color: '#ff6666',
            align: 'center'
        }).setOrigin(0.5);

        const play = new Button(this, pos.X(50), pos.Y(80), pos.X(20), pos.Y(10), uiConfig.COLOR, '😺 Play 🐭', pos.Y(5), 'bold', 'white', () => {
            errorText.setText('');
            this.socket.emit('joinRequest', {
                code: code.text,
                nick: nick.text
            }, (bool, data) => {
                if (bool) {
                    data.socket = this.socket;
                    this.scene.start('Lobby', data);
                } else {
                    errorText.setText(data);
                }
            });
        });
    }

    update() {
    }
}
