import { Card } from './Card.js'
import { Button } from './Button.js'
import { pos, deckConfig, handConfig, cardConfig, uiConfig } from './Config.js'

export class DeckStack {

    constructor(scene) {
        this.scene = scene;
        this.array = [];

        const deckLength = Object.keys(scene.players).length * deckConfig.PER_PLAYER;

        this.counter = new Button(scene, deckConfig.X - pos.Y(9), deckConfig.Y - pos.Y(9), pos.Y(6), pos.Y(6), uiConfig.COLOR, deckLength, pos.Y(3), 'bold', 'white');

        for (let i = 0; i < deckLength; i ++) {
            this.push(new Card(scene, deckConfig.X, deckConfig.Y, cardConfig.SCALE, null, 'deck', false));
        }

        this.setDragEvents();

    }

    setDragEvents() {
        const card = this.topCard;

        card.removeAllListeners();

        card.setDraggable(true);

        card.on('pointerdown', () => {

            if ((!card.draggable) ||
                (card != this.topCard && card != this.holdCard) ||
                (card == this.topCard && (!this.scene.myTurn || this.holdCard || this.scene.skip.visible))) return;
            card.dragging = true;

            if (!this.holdCard) {
                this.holdCard = this.pop();
                this.count();
                this.scene.stand.setVisible(false);

                this.scene.socket.emit('drawRequest', { code: this.scene.code }, (key) => {
                    card.key = key;
                    this.scene.playStack.setDropZone(key != 11);
                });
            } else {
                this.scene.playStack.setDropZone(card.key != 11);
            }

            this.scene.handStack.setDropZone(true);

            card.flip(true)
                .setDepth(1);

        });

        card.on('drag', (pointer, dragX, dragY) => {

            if (!card.dragging) return;

            card.setPosition(dragX, dragY);

        });

        card.on('dragenter', (pointer, gameObject, dropZone) => {

            if (!card.dragging) return;

            card.dropped = true;

            gameObject.tint(this.scene.players[this.scene.socket.id].color);
            card.setAlpha(uiConfig.SELECTED_ALPHA);

        });

        card.on('dragleave', (pointer, gameObject, dropZone) => {

            if (!card.dragging) return;

            card.dropped = false;

            gameObject.clearTint();
            card.setAlpha(1);

        });

        card.on('drop', (pointer, gameObject, dropZone) => {

            if (!card.dragging) return;

            gameObject.clearTint();
            card.setAlpha(1);
            card.setDepth(0);

            if (gameObject.type === 'play') {

                const key = card.key;

                this.scene.socket.emit('playRequest', { code: this.scene.code, card: key });
                this.scene.playStack.play(card);

                if (key <= 4) {
                    this.scene.myTurn = false;
                    this.scene.socket.emit('turnEnd', { code: this.scene.code });
                } else {
                    this.scene.skip.setVisible(true);

                    if (key === 5 || key === 6) {
                        this.scene.peeks.self = 1;
                        this.scene.waitingPeek = true;
                    } else if (key === 7 || key === 8) {
                        this.scene.peeks.alien = 1;
                        this.scene.waitingPeek = true;
                    } else if (key === 9) {
                        this.scene.trade = true;
                        this.scene.waitingTrade = true;
                    } else if (key === 10) {
                        this.scene.peeks.self = 1;
                        this.scene.peeks.alien = 1;
                        this.scene.peekTrade = true;
                        this.scene.waitingTrade = true;
                    }
                }

            } else if (gameObject.type === 'hand') {

                this.scene.socket.emit('swapRequest', { code: this.scene.code, i: gameObject.i, j: gameObject.j }, (key) => {
                    const swapped = this.scene.handStack.swap(card, gameObject.i, gameObject.j);
                    swapped.key = key;
                    this.scene.playStack.play(swapped);
                });

                this.scene.myTurn = false;
                this.scene.socket.emit('turnEnd', { code: this.scene.code });

            }

            this.holdCard = null;
        });

        card.on('dragend', () => {

            if (!card.dragging) return;
            card.dragging = false;

            this.scene.playStack.setDropZone(false);
            this.scene.handStack.setDropZone(false);

            if (card.dropped) {
                card.dropped = false;

            } else {
                card.flip(false).back();
            }

        });
    }

    push(card) {

        card.type = 'deck';
        card.key = null;

        this.array.push(card);

        if (this.topCard) {
            this.topCard
                .off()
                .removeAllListeners()
        }

        this.topCard = card;
        this.setDragEvents();
        this.count();
        this.order();

    }

    pushAll(cards) {

        for (const card of cards) {
            card.type = 'deck';
            card.key = null;
            card.setFrame(12);
            card.setScale(card.oScale);
            if (this.topCard) {
                this.topCard.off().removeAllListeners();
            }
            this.topCard = card;
            this.array.push(card);
        }

        if (this.topCard) {
            this.setDragEvents();
        }

        this.count();
        this.order();

        if (this.holdCard && this.topCard) {
            this.holdCard.oX = this.topCard.oX;
            this.holdCard.oY = this.topCard.oY;
        }

    }

    pop() {

        const card = this.array.pop();

        this.topCard = this.array[this.array.length - 1];

        if (this.topCard) {
            this.setDragEvents();
        }

        this.count();
        this.order();
        return card;

    }

    order() {
        
        for (let i = 0; i < this.array.length; i ++) {

            const card = this.array[i];

            card.oX = deckConfig.X + (i - (this.array.length - 1) / 2) * pos.Y(0.05);
            card.oY = deckConfig.Y + ((this.array.length - 1) / 2 - i) * pos.Y(0.05);

            card.tween({
                x: deckConfig.X + (i - (this.array.length - 1) / 2) * pos.Y(0.05),
                y: deckConfig.Y + ((this.array.length - 1) / 2 - i) * pos.Y(0.05),
                duration: 200,
                ease: 'Quart.out',
                onComplete: () => {
                    card.flip(false);
                }
            });
        }

    }

    computeAlienHoldPosition(id) {
        const handStack = this.scene.handStacks[id];
        const maxLen = Math.max(...handStack.array.map(row => row.length));
        const cardW = cardConfig.SIZE * handStack.scale;
        const rowWidth = maxLen > 0 ? maxLen * cardW + (maxLen - 1) * handStack.margin : 0;
        const direction = handStack.x < pos.X(50) ? 1 : -1;
        return {
            x: handStack.x + direction * (rowWidth / 2 + handStack.margin + cardW / 2),
            y: handStack.y
        };
    }

    alienDraw(id) {

        this.alienHoldCard = this.pop();
        this.alienHoldId = id;

        this.alienHoldCard.setDepth(1);

        const { x, y } = this.computeAlienHoldPosition(id);

        this.alienHoldCard.tween({
            x,
            y,
            scaleX: cardConfig.ALIEN_SCALE,
            scaleY: cardConfig.ALIEN_SCALE,
            alpha: uiConfig.SELECTED_ALPHA,
            duration: 200,
            ease: 'Quart.out'
        });

        this.alienHoldCard.highlight(this.scene.players[id].color);

    }

    repositionAlienHold() {
        if (!this.alienHoldCard || !this.alienHoldId) return;
        if (!this.scene.handStacks[this.alienHoldId]) return;
        const { x, y } = this.computeAlienHoldPosition(this.alienHoldId);
        this.alienHoldCard.tween({
            x,
            y,
            duration: 200,
            ease: 'Quart.out'
        });
    }

    count(delta = 0) {
        this.counter.setText(this.array.length + delta);
    }
}