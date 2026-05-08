import { uiConfig, TEXT_RESOLUTION } from './Config.js';

export class Button extends Phaser.GameObjects.Container {

    constructor(scene, x, y, w, h, color, text, textSize, textStyle, textColor, callback = null) {
        
        super(scene, x, y);

        this.hitbox = scene.add.rectangle(- w / 2, - h / 2, w, h, color).setRounded(uiConfig.BABEL).setVisible(false);
        this.shape = scene.add.rectangle(0, 0, w, h, color).setRounded(uiConfig.BABEL);
        this.label = scene.add.text(0, 0, text, {fontFamily: uiConfig.FONT, fontSize: textSize, fontStyle: textStyle, color: textColor}).setOrigin(0.5).setResolution(TEXT_RESOLUTION);

        this.add([this.shape, this.label]);
        this.setInteractive(this.hitbox, Phaser.Geom.Rectangle.Contains);

        scene.add.existing(this);

        if (callback != null) {
            this.setClickEvents(callback);
        }
    }

    setClickEvents(callback) {

        this.on(Phaser.Input.Events.POINTER_OVER, () => {
            this.setAlpha(uiConfig.SELECTED_ALPHA);
        });

        this.on(Phaser.Input.Events.POINTER_OUT, () => {
            this.setAlpha(1);
        });

        this.on(Phaser.Input.Events.POINTER_DOWN, () => {
            callback();
        });
    }

    getText() {
        return this.label.text;
    }

    setText(text) {
        this.label.text = text;
    }

    enable(bool) {
        if (bool) {
            this.setInteractive(true);
        } else {
            this.disableInteractive(true);
        }
    }

    setOutlined(bool, color = 0xffffff, thickness = null, gap = null) {
        if (thickness === null) thickness = Math.max(2, this.shape.height * 0.08);
        if (gap === null) gap = thickness;
        if (bool) {
            if (!this.outline) {
                const w = this.shape.width + gap * 2 + thickness;
                const h = this.shape.height + gap * 2 + thickness;
                this.outline = this.scene.add.rectangle(0, 0, w, h)
                    .setRounded(uiConfig.BABEL + gap)
                    .setFillStyle()
                    .setStrokeStyle(thickness, color);
                this.addAt(this.outline, 0);
            } else {
                this.outline.setStrokeStyle(thickness, color);
            }
            this.outline.setVisible(true);
        } else if (this.outline) {
            this.outline.setVisible(false);
        }
        return this;
    }
}