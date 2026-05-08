import { Button } from '../objects/Button.js'
import { TextInput } from '../objects/TextInput.js'
import { pos, uiConfig, cardConfig, handConfig, TEXT_RESOLUTION } from '../objects/Config.js'

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

        // Generous char limit as a safety net; the actual nickname length is
        // gated by rendered text width below so it always fits the nameplate.
        const nick = new TextInput(this, pos.X(50), pos.Y(65), pos.X(20), pos.Y(10), 32, 'Nickname',
            'Enter your nickname. This will be displayed in the game.', pos.Y(5), '#ffffff'
        );

        // Mirror the nameplate's font/width math from HandStack so we can
        // measure exactly the same way the in-game label will render. The
        // self hand's plate is the larger of the two scales, but since
        // labelFont scales with labelW (labelFont = labelW / 7), the ratio
        // text-width / plate-width is the same on alien plates — fitting
        // here means fitting on every plate.
        const nameplateW = 2 * cardConfig.SIZE * cardConfig.SCALE + handConfig.MARGIN;
        const nameplateFont = nameplateW / 7;
        const nameplateInnerW = nameplateW - 30;
        const measureCanvas = document.createElement('canvas');
        const measureCtx = measureCanvas.getContext('2d');
        measureCtx.font = `bold ${nameplateFont}px ${uiConfig.FONT}`;
        nick.on('textchange', () => {
            let trimmed = nick.text;
            while (trimmed.length > 0 && measureCtx.measureText(trimmed).width > nameplateInnerW) {
                trimmed = trimmed.slice(0, -1);
            }
            if (trimmed !== nick.text) nick.text = trimmed;
        });

        const errorText = this.add.text(pos.X(50), pos.Y(90), '', {
            fontSize: pos.Y(3) + 'px',
            color: '#ff6666',
            align: 'center'
        }).setOrigin(0.5).setResolution(TEXT_RESOLUTION);

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
