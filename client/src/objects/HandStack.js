import { Card } from './Card.js';
import { pos, deckConfig, handConfig, cardConfig, uiConfig } from './Config.js';

export class HandStack {

    constructor(scene, id, idx, maxIdx) {
        this.scene = scene;
        this.id = id;
        this.type = id == scene.socket.id ? 'self' : 'alien';

        this.array = [];
        this.x = handConfig.X[maxIdx][idx];
        this.y = handConfig.Y[maxIdx][idx];
        this.scale = this.type == 'self' ? cardConfig.SCALE : cardConfig.ALIEN_SCALE;
        this.margin = this.type == 'self' ? handConfig.MARGIN : handConfig.ALIEN_MARGIN;

        for (let i = 0; i < handConfig.ROWS; i ++) {
            this.array.push([]);
        }
    }

    setOut() {
        this.out = true;
        this.iterate((card) => {
            card.setDraggable(false);
            card.setDropZone(false);
            card.setAlpha(0.4);
        });
    }

    reveal(hand, startDelay = 0, delayPerCard = 300) {
        let cardIdx = 0;
        for (let i = 0; i < hand.length; i++) {
            for (let j = 0; j < hand[i].length; j++) {
                if (this.array[i] && this.array[i][j]) {
                    const card = this.array[i][j];
                    const key = hand[i][j];
                    this.scene.time.delayedCall(startDelay + cardIdx * delayPerCard, () => {
                        if (card.active) {
                            card.key = key;
                            card.flip(true);
                        }
                    });
                    cardIdx++;
                }
            }
        }
        return startDelay + cardIdx * delayPerCard;
    }

    // !! Don't call this method before ordering as card needs to have x and y defined to be able to back() !!
    setDragEvents(card) {

        card.removeAllListeners();

        card.setDraggable(true);

        card.on('pointerdown', () => {

            if (this.out) return;

            if (this.scene.peeks[this.type] && !this.scene.peekedCards.includes(card)) {

                this.scene.peeks[this.type] --;

                this.scene.socket.emit('peekRequest', { code: this.scene.code, id: this.id, i: card.i, j: card.j }, (key) => {
                    card.peek(key);
                });

                this.scene.peekedCards.push(card);

                if (this.scene.waitingPeek) {
                    this.scene.skip.setVisible(false);
                    this.scene.myTurn = false;
                    this.scene.socket.emit('turnEnd', { code: this.scene.code });
                }

            }

            if (!card.draggable) return;
            card.dragging = true;

            card.setDepth(1);
            // There is no need to define x and y as those have been defined in this.order()

            if (this.scene.copy && !(this.scene.peekTrade && this.scene.peekedCards.includes(card))) {
                this.scene.playStack.setDropZone(true);

            }

            if (this.scene.trade) {

                for (const handStack of Object.values(this.scene.handStacks)) {
                    if (handStack !== this && !handStack.out) {
                        handStack.setDropZone(true);
                    }
                }

            } else if (this.scene.peekTrade && this.scene.peekedCards.includes(card)) {

                for (const peekedCard of this.scene.peekedCards) {
                    if (peekedCard !== card) {
                        peekedCard.setDropZone(true);
                    }
                }
            }

        });

        card.on('drag', (pointer, dragX, dragY) => {

            if (!card.dragging) return;

            card.setPosition(dragX, dragY);

        });

        card.on('dragenter', (pointer, gameObject, dropZone) => {

            if (!card.dragging) return;

            card.dropped = true;

            gameObject.tint(this.scene.players[this.id].color);
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
            card.setAlpha(1)

            if (gameObject.type == 'play') {
                
                this.scene.copy = false;

                this.scene.socket.emit('copyRequest', { code: this.scene.code, id: this.id, i: card.i, j: card.j }, (key) => {
                    card.key = key;
                    this.scene.playStack.play(this.pop(card.i, card.j));
                });

            } else if (gameObject.type == 'hand') {

                this.scene.socket.emit('tradeRequest', { 
                    code: this.scene.code, 
                    traderId: card.id, 
                    tradedId: gameObject.id,
                    traderI: card.i,
                    tradedI: gameObject.i,
                    traderJ: card.j,
                    tradedJ: gameObject.j
                });

                const id = gameObject.id;
                const i = gameObject.i;
                const j = gameObject.j;
                this.swap(gameObject, card.i, card.j);
                this.scene.handStacks[id].swap(card, i, j);

                if (this.scene.waitingTrade) {
                    this.scene.skip.setVisible(false);
                    this.scene.myTurn = false;
                    this.scene.socket.emit('turnEnd', { code: this.scene.code });
                }
            }
        });


        card.on('dragend', () => {

            if (!card.dragging) return;
            card.dragging = false;

            this.scene.playStack.setDropZone(false);
            for (const handStack of Object.values(this.scene.handStacks)) {
                handStack.setDropZone(false);
            }
            
            card.setDepth(0);

            if (card.dropped) {
                card.dropped = false;
            } else {
                card.back(); 
            }
        });
    }

    draw(i) {
        this.add(this.scene.deckStack.pop(), i);
    }

    add(card, i, onCompleteOrdering = () => {}) {
        card.type = 'hand';
        card.oScale = this.scale;
        card.id = this.id;
        
        card.setDepth(0);

        this.array[i].push(card);
        this.order(() => {
            card.flip(false, false, onCompleteOrdering.bind(this));
        });

        this.setDragEvents(card);
    }

    swap(card, i, j) {
        const current = this.array[i][j];

        card.type = 'hand';
        card.oScale = this.scale;
        card.id = this.id;
        
        card.setDepth(0);

        this.array[i][j] = card;
        this.order(() => {
            card.flip(false)
        });

        this.setDragEvents(card);

        return current;
    }

    alienSwap(key, i, j) {
        const alienCard = this.scene.deckStack.alienHoldCard;
        this.scene.deckStack.alienHoldCard = null;
        this.scene.deckStack.alienHoldId = null;
        const card = this.swap(alienCard, i, j);
        card.key = key;
        this.scene.playStack.play(card);
    }

    alienCopy(key, i, j) {
        const card = this.pop(i, j);
        card.key = key
        this.scene.playStack.play(card);
    }

    pop(i, j) {
        const card = this.array[i].splice(j, 1)[0];
        this.order();
        return card;
    }

    highlight(i, j, color) {
        const card = this.get(i, j);
        card.highlight(color);
    }

    order(onComplete = () => {}) {
        if (this.scene.deckStack.alienHoldId === this.id) {
            this.scene.deckStack.repositionAlienHold();
        }
        let y = this.y - (handConfig.ROWS * cardConfig.SIZE * this.scale + (handConfig.ROWS - 1) * this.margin ) / 2 + cardConfig.SIZE * this.scale / 2;
        for (let i = 0; i < handConfig.ROWS; i ++) {

            let x = this.x - (this.array[i].length * cardConfig.SIZE * this.scale + (this.array[i].length - 1) * this.margin ) / 2 + cardConfig.SIZE * this.scale / 2;
            for (let j = 0; j < this.array[i].length; j ++) {

                const card = this.array[i][j]

                card.i = i;
                card.j = j;
                
                card.setDepth(1);

                card.tween({
                    x: x + j * (cardConfig.SIZE * this.scale + this.margin),
                    y: y + i * (cardConfig.SIZE * this.scale + this.margin),
                    scaleX: this.scale,
                    scaleY: this.scale,
                    alpha: 1,
                    duration: 200,
                    ease: 'Quart.out',
                    onUpdate: () => {
                        card.oX = x + j * (cardConfig.SIZE * this.scale + this.margin);
                        card.oY = y + i * (cardConfig.SIZE * this.scale + this.margin);
                    },
                    onComplete: () => {
                        card.setDepth(0);
                        onComplete.call(this);
                    }
                });
            }
        }
    }

    iterate(callback) {
        for (let i = 0; i < handConfig.ROWS; i ++) {
            for (let j = 0; j < this.array[i].length; j ++) {
                callback(this.array[i][j]);
            }
        }
    }

    get(i, j) {
        return this.array[i][j];
    }

    setDropZone(bool) {
        this.iterate((card) => {
            card.setDropZone(bool);
        });
    }
}