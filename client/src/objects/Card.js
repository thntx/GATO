import { pos, cardConfig, uiConfig } from './Config.js'
import { ColorReplacePipeline } from './ColorReplacePipeline.js'

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

        // Whether the local player has personally seen this card's value at
        // some point in this game (via peek phase, peek effects, or drawing).
        // Drives the playstack-drop gate in HandStack: only known cards can be
        // played as copies. Reset when a card cycles back into the deck
        // through a reshuffle (DeckStack.pushAll).
        this.known = false;

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

    peek(key, onComplete = () => {}, onFlipBackStart = () => {}) {
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
                        // Card was copied/swapped to the playstack mid-peek
                        // — skip the flip-back (and any unpeek-aligned hook)
                        // since the visual is no longer a peeking card.
                        this.peeking = false;
                        return;
                    }
                    onFlipBackStart.call(this);
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

    // Recolor the card's blue (the same hex used for the rest of the UI) to
    // `hex`, leaving white numerals/sparkles and the cat/mouse art alone. The
    // pulse yoyo-tweens the swap amount from 0 to 1 and back so the colored
    // state is unambiguous at peak without being permanent. The pipeline is
    // attached on-demand and detached on completion to keep the per-frame
    // PostFX cost zero for cards at rest. Re-triggering while a pulse is in
    // flight cancels the old one and restarts cleanly — without this, two
    // peeks in quick succession would either stack tweens or the first
    // pulse's onComplete would tear down the pipeline mid-second-pulse.
    highlight(hex, onComplete = () => {}) {
        this._stopHighlightTween();
        const ms = 1000;
        this._setupReplace(hex);
        this._highlightTween = this.scene.tweens.addCounter({
            from: 0,
            to: ms,
            duration: ms,
            yoyo: true,
            hold: 0,
            ease: 'Sine.inout',
            onUpdate: (tween) => {
                const v = tween.getValue() / ms;
                this._setReplaceAmount(v);
            },
            onComplete: () => {
                this._highlightTween = null;
                this._clearReplace();
                onComplete.call(this);
            }
        });
        return this;
    }

    tint(hex) {
        this._stopHighlightTween();
        this._setupReplace(hex);
        this._setReplaceAmount(1);
        return this;
    }

    clearTint() {
        super.clearTint();
        this._stopHighlightTween();
        this._clearReplace();
        return this;
    }

    _stopHighlightTween() {
        if (this._highlightTween) {
            this._highlightTween.stop();
            this._highlightTween = null;
        }
    }

    _setupReplace(hex) {
        let pipe = this.getPostPipeline(ColorReplacePipeline);
        if (Array.isArray(pipe)) pipe = pipe[0];
        if (!pipe) {
            this.setPostPipeline(ColorReplacePipeline);
            pipe = this.getPostPipeline(ColorReplacePipeline);
            if (Array.isArray(pipe)) pipe = pipe[0];
        }
        if (pipe) {
            pipe.setSourceHex(uiConfig.COLOR);
            pipe.setTargetHex(hex);
        }
    }

    _setReplaceAmount(v) {
        let pipe = this.getPostPipeline(ColorReplacePipeline);
        if (Array.isArray(pipe)) pipe = pipe[0];
        if (pipe) pipe.setAmount(v);
    }

    _clearReplace() {
        // Phaser's removePostPipeline(class) compares instance === class which
        // is always false — only the string-name path actually removes. The
        // pipeline is registered as 'ColorReplacePipeline' in Game.create.
        this.removePostPipeline('ColorReplacePipeline');
    }

    setDraggable(bool) {
        this.draggable = bool;
    }

    setDropZone(bool) {
        if (!this.input) console.log('no input');
        this.input.dropZone = bool;
    }

    // Cancel an in-progress drag on this card without firing the user-driven
    // drop / dragend cleanup. Used when a server event (alien copy/swap/trade)
    // removes or relocates a card the local user happens to be dragging — the
    // drag handler would otherwise keep overwriting the card's position with
    // the cursor every frame, fighting the play/order tween, and dragend on
    // mouse-release would back() the card to a stale oX/oY. We mute the drag
    // and reset the visual state by hand so the server-driven tween can run
    // unmolested. Drop zones are cleared because dragend's normal cleanup is
    // skipped via its !dragging early return.
    cancelDrag() {
        if (!this.dragging) return;
        this.dragging = false;
        this.dropped = false;
        this.setAlpha(1);
        this.clearTint();
        this.setDepth(0);
        if (this.scene && this.scene.playStack) {
            this.scene.playStack.setDropZone(false);
        }
        if (this.scene && this.scene.handStacks) {
            for (const hs of Object.values(this.scene.handStacks)) {
                hs.setDropZone(false);
            }
        }
    }
}