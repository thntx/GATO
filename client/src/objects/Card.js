import { pos, cardConfig } from './Config.js'

export class Card extends Phaser.GameObjects.Sprite {

    constructor(scene, x, y, scale, key, type, flip) {
        super(scene, x, y, 'cards', flip ? key : 12)
            .setScale(scale)
            .setInteractive();

        this.key = key;
        this.oScale = scale;
        this.type = type;

        this.draggable = false;

        this.dragging = false;
        this.dropped = false;

        this.tweenQueue = [];

        scene.add.existing(this);

        scene.input.setDraggable(this);

    }

    tween(data, wait = false) {
        if (!this.scene || !this.scene.tweens) return;

        // If already tweening, add to queue and return
        if (this.tweening && wait) {
            console.log(this.tweenQueue);
            console.log('adding');
            this.tweenQueue.push(data);
            return;
        }

        this.tweening = true;

        // Wrap callbacks to check scene existence
        const wrapCallback = (cb) => {
            if (!cb) return undefined;
            return (...args) => {
                if (this.scene) cb.apply(this, args);
            };
        };

        if (!data.targets) {
            data.targets = this;
        }

        const onComplete = data.onComplete;

        data.onComplete = wrapCallback(() => {
            if (onComplete) {
                onComplete.call(this);
            }

            this.tweening = false;

            if (this.tweenQueue.length > 0) {
                this.tween(this.tweenQueue.shift());
            }
        });

        if (data.onUpdate) data.onUpdate = wrapCallback(data.onUpdate);
        if (data.onYoyo) data.onYoyo = wrapCallback(data.onYoyo);
        if (data.onRepeat) data.onRepeat = wrapCallback(data.onRepeat);

        this.scene.tweens.add(data);
    }

    countween(data, wait = false) {
        if (!this.scene || !this.scene.tweens) return;

        // If already countweening, add to queue and return
        if (this.tweening && wait) {
            this.tweenQueue.push(data);
            return;
        }

        this.tweening = true;

        // Wrap callbacks to check scene existence
        const wrapCallback = (cb) => {
            if (!cb) return undefined;
            return (...args) => {
                if (this.scene) cb.apply(this, args);
            };
        };

        const onComplete = data.onComplete;

        data.onComplete = wrapCallback(() => {
            if (onComplete) {
                onComplete.call(this);
            }

            this.tweening = false;

            if (this.tweenQueue.length > 0) {
                this.tween(this.tweenQueue.shift());
            }
        });

        if (data.onUpdate) data.onUpdate = wrapCallback(data.onUpdate);
        if (data.onYoyo) data.onYoyo = wrapCallback(data.onYoyo);
        if (data.onRepeat) data.onRepeat = wrapCallback(data.onRepeat);

        this.scene.tweens.addCounter(data);
    }

    flip(bool, peek = false, onComplete = () => {}) {
        if (this.peeking && !peek) this.cancelPeek = true;

        if ((bool == (this.frame.name == 12))) {
            this.flipping = true;
            this.tween({
                scaleX: 0,
                duration: 100,
                ease: 'Sine.in',
                onComplete: () => {
                    this.setFrame(bool ? this.key : 12);
                    this.tween({
                        targets: this,
                        scaleX: this.oScale,
                        scaleY: this.oScale,
                        duration: 100,
                        ease: 'Sine.out',
                        onComplete: () => {
                            this.flipping = false;
                            onComplete.call(this);
                        }
                    });
                }
            });
        }
        return this;
    }

    peek(key, onComplete = () => {}) {
        this.peeking = true;
        this.key = key;
        this.flip(true, true, () => {
            this.tween({
                targets: { dummy: 0 },
                dummy: 1000,
                duration: 1000,
                onComplete: () => {
                    const cancelled = this.cancelPeek;
                    this.cancelPeek = false;
                    if (this.type === 'play') {
                        this.peeking = false;
                        return;
                    }
                    this.flip(false, true, () => {
                        this.peeking = false;
                        if (!cancelled) onComplete.call(this);
                    });
                }
            });
        });
        return this;
    }

    back(global = false, onComplete = () => {}) {
        this.disableInteractive(true);

        const data = {
            x: this.oX,
            y: this.oY,
            duration: 300,
            ease: 'Back.out',
            onComplete: () => {
                if (this.x !== this.oX || this.y !== this.oY) {
                    this.back(global, onComplete);
                } else {
                    this.setInteractive(true);
                    onComplete.call(this);
                }
            }
        };

        if (global) {
            data.onUpdate = () => {
                this.scene.socket.emit('moveRequest', { code: this.scene.code, x: this.x, y: this.y });
            }
        }

        this.tween(data);

        return this;
    }

    highlight(hex, onComplete = () => {}) {
        const ms = 1000
        this.countween({
            from: 0,
            to: ms,
            duration: ms,
            yoyo: true,
            hold: 0,
            ease: 'Sine.inout',
            onUpdate: (tween) => {
                const v = tween.getValue() / ms;
                this.setTint(this.whiten(hex, v/2));
            },
            onComplete: () => {
                this.clearTint();
                onComplete.call(this);
            }
        });
        return this;
    }

    tint(hex) {
        this.setTint(this.whiten(hex, 0.5));
        return this;
    }

    whiten(hex, value) {
        const white = Phaser.Display.Color.ValueToColor(0xffffff);
        const color = Phaser.Display.Color.ValueToColor(hex);
        const r = Phaser.Math.Interpolation.Linear([white.red, color.red], value);
        const g = Phaser.Math.Interpolation.Linear([white.green, color.green], value);
        const b = Phaser.Math.Interpolation.Linear([white.blue, color.blue], value);
        return Phaser.Display.Color.GetColor(r, g, b);
    }

    setDraggable(bool) {
        this.draggable = bool;
    }

    setDropZone(bool) {
        if (!this.input) console.log('no input');
        this.input.dropZone = bool;
    }
}