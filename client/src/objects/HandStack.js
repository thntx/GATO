import { Card } from './Card.js';
import { Button } from './Button.js';
import { pos, deckConfig, handConfig, cardConfig, uiConfig, SOUND_MS } from './Config.js';

export class HandStack {

    constructor(scene, id, idx, maxIdx) {
        this.scene = scene;
        this.id = id;
        this.type = id == scene.socket.id ? 'self' : 'alien';

        this.array = [];
        this.x = handConfig.X[maxIdx][idx];
        this.y = handConfig.Y[maxIdx][idx];
        // Six- and seven-player rooms (maxIdx >= 4) put up to three aliens on
        // a side, so they use a smaller card scale + margin to keep each
        // hand's vertical footprint within its share of the screen.
        const tightAliens = maxIdx >= 4;
        this.scale = this.type == 'self'
            ? cardConfig.SCALE
            : (tightAliens ? cardConfig.SMALL_ALIEN_SCALE : cardConfig.ALIEN_SCALE);
        this.margin = this.type == 'self'
            ? handConfig.MARGIN
            : (tightAliens ? handConfig.SMALL_ALIEN_MARGIN : handConfig.ALIEN_MARGIN);

        for (let i = 0; i < handConfig.ROWS; i ++) {
            this.array.push([]);
        }

        const handH = handConfig.ROWS * cardConfig.SIZE * this.scale + (handConfig.ROWS - 1) * this.margin;
        const labelW = 2 * cardConfig.SIZE * this.scale + this.margin;
        const labelFont = labelW / 7;
        const labelH = labelFont * 1.4;
        // Scale the label-to-hand gap by the hand's own scale so alien hands
        // (which use ALIEN_SCALE) keep the same visual proximity ratio as the
        // self hand. A fixed gap looks too far away on the smaller alien hands.
        const labelGap = pos.Y(2) * this.scale / cardConfig.SCALE;
        const labelY = this.y - handH / 2 - labelGap - labelH / 2;
        const player = scene.players[id];
        this.nickLabel = new Button(scene, this.x, labelY, labelW, labelH, player.color, player.nick, labelFont, 'bold', 'white');
    }

    setActive(bool) {
        const color = this.scene.players[this.id].color;
        this.nickLabel.setOutlined(bool, color);
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
        // Ensure client visual state matches server hand before revealing.
        // If any card the server has isn't present in this.array (e.g. a
        // deal event arrived while deckStack was out of sync and silently
        // failed, or a late-game +3 penalty's deals raced with gameEnd),
        // create a face-down placeholder so it still gets revealed. Without
        // this, server cards at missing positions are skipped entirely.
        let createdMissing = false;
        for (let i = 0; i < hand.length; i++) {
            if (!this.array[i]) this.array[i] = [];
            for (let j = 0; j < hand[i].length; j++) {
                if (!this.array[i][j]) {
                    const placeholder = new Card(this.scene, this.x, this.y, this.scale, null, 'hand', false);
                    placeholder.id = this.id;
                    placeholder.oScale = this.scale;
                    this.array[i][j] = placeholder;
                    createdMissing = true;
                }
            }
        }
        if (createdMissing) {
            this.order();
        }

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
                            this.scene.playSound('show');
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

            if (this.scene.frozen) return;
            if (this.out) return;

            if (this.scene.peeks[this.type] && !this.scene.peekedCards.includes(card)) {

                this.scene.peeks[this.type] --;
                // Mark the card known synchronously, before the peekRequest
                // callback comes back. This is what lets the drag-setup a
                // few lines below enable the playstack drop zone in the SAME
                // pointerdown — the player can peek and drag-to-copy in one
                // motion. The server already received our peekRequest before
                // any subsequent copyRequest (FIFO per socket) so its own
                // knownCards set is also up to date.
                card.known = true;

                this.scene.socket.emit('peekRequest', { code: this.scene.code, id: this.id, i: card.i, j: card.j }, (key) => {
                    if (key == null) return;
                    // Hook the unpeek sound onto Card.peek's flip-back start
                    // so it lines up with the actual visual. Card.peek
                    // suppresses both the flip-back and this callback when
                    // the card was copied to the playstack mid-peek, so the
                    // sound naturally drops in that case.
                    card.peek(key, undefined, () => {
                        this.scene.playActionSound('unpeek', this.scene.socket.id);
                    });
                    this.scene.playActionSound('peek', this.scene.socket.id);
                });

                this.scene.peekedCards.push(card);
                this.scene.recordPeek(this.scene.socket.id);
                // No client freeze on peek — the peeker is free to follow up
                // with a copy on the just-peeked card while it's still face
                // up. The server's per-effect sleep (and the peek visual
                // itself) provides the "think time" without locking the UI.

                if (this.scene.waitingPeek) {
                    // Lock the local UI and let the server's activeEffect
                    // tracking advance the turn — peek doesn't freeze, so the
                    // turnStart event arrives essentially right after this.
                    this.scene.skip.setVisible(false);
                    this.scene.myTurn = false;
                }

            }

            if (!card.draggable) return;
            card.dragging = true;

            card.setDepth(1);
            // There is no need to define x and y as those have been defined in this.order()

            // The playstack accepts any card the local player has personally
            // seen (peek phase, peek effects, or having drawn it). Cards
            // peeked during a card-10 peekTrade are allowed too — copying
            // one of them on the playstack substitutes for the trade and
            // ends the player's turn (server treats it as a completion of
            // the activeEffect). Unknown cards never become a drop target,
            // so the drag silently bounces back via dragend → card.back().
            if (this.scene.copy && card.known) {
                this.scene.playStack.setDropZone(true);

            }

            if (this.scene.trade) {

                // Card 9 trades have to involve the local player — either as
                // trader (own card → alien) or tradee (alien card → own).
                // When the dragged card belongs to another player, only the
                // self hand is a valid drop target; otherwise any alien hand
                // is. Without this branch the unified drop logic would let
                // the local user move cards between two other players, which
                // the server now also rejects (TRADE DENIED) but we don't
                // want the optimistic local swap to flash on screen first.
                if (this.id === this.scene.socket.id) {
                    for (const handStack of Object.values(this.scene.handStacks)) {
                        if (handStack !== this && !handStack.out) {
                            handStack.setDropZone(true);
                        }
                    }
                } else {
                    const selfStack = this.scene.handStacks[this.scene.socket.id];
                    if (selfStack && !selfStack.out) selfStack.setDropZone(true);
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

                this.scene.socket.emit('copyRequest', { code: this.scene.code, id: this.id, i: card.i, j: card.j }, (result) => {
                    if (result === null) {
                        // Server rejected: the dropped card wasn't in this
                        // player's known set, or the slot was emptied by a
                        // concurrent action. Restore the copy gate so the
                        // player can try a different (known) card, and animate
                        // the rejected card back to its hand position.
                        this.scene.copy = true;
                        card.back();
                        return;
                    }
                    card.key = result.key;
                    const played = this.pop(card.i, card.j);
                    this.scene.playStack.play(played, true);
                    played.highlight(this.scene.players[this.scene.socket.id].color);
                    this.scene.playActionSound(result.success ? 'copy' : 'fail', this.scene.socket.id);
                    if (result.success) {
                        // Right copy: penalty (if any) goes to the target,
                        // not to the copier. We just freeze for the copy
                        // sound itself and let the take sounds arrive on the
                        // target's client.
                        this.scene.freeze(SOUND_MS.copy);
                    } else {
                        // Wrong copy: the copier (us) gets +2 cards (or +3
                        // for a CAT). Freeze for the fail sound plus the
                        // full take sequence so the player can't queue
                        // another action while their penalty is still being
                        // dealt out.
                        const takes = result.key === 11 ? 3 : 2;
                        this.scene.freeze(SOUND_MS.fail + takes * SOUND_MS.take);
                    }
                    // If this copy completed an active peek (5-8) or
                    // peekTrade (10) / trade (9) effect, the server is about
                    // to advance the turn — hide the skip button and clear
                    // local effect flags so the UI matches before turnStart
                    // arrives.
                    if (this.scene.waitingPeek || this.scene.waitingTrade) {
                        this.scene.skip.setVisible(false);
                        this.scene.myTurn = false;
                        this.scene.waitingPeek = false;
                        this.scene.waitingTrade = false;
                        this.scene.peekTrade = false;
                        this.scene.trade = false;
                        this.scene.peeks = { self: 0, alien: 0 };
                    }
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
                this.scene.playActionSound('trade', this.scene.socket.id);
                this.scene.freeze(SOUND_MS.trade);

                const id = gameObject.id;
                const i = gameObject.i;
                const j = gameObject.j;
                this.swap(gameObject, card.i, card.j, 400);
                this.scene.handStacks[id].swap(card, i, j, 400);

                if (this.scene.waitingTrade) {
                    // Server auto-advances the turn after the trade sound's
                    // sleep. Lock the local UI and let turnStart drive the
                    // visual state change.
                    this.scene.skip.setVisible(false);
                    this.scene.myTurn = false;
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

    swap(card, i, j, duration = 200) {
        const current = this.array[i][j];

        card.type = 'hand';
        card.oScale = this.scale;
        card.id = this.id;

        card.setDepth(0);

        this.array[i][j] = card;
        this.order(() => {
            card.flip(false)
        }, duration);

        this.setDragEvents(card);

        return current;
    }

    alienSwap(key, i, j) {
        const alienCard = this.scene.deckStack.alienHoldCard;
        this.scene.deckStack.alienHoldCard = null;
        this.scene.deckStack.alienHoldId = null;
        const card = this.swap(alienCard, i, j);
        card.cancelDrag();
        // The displaced card now lives on the playstack, so it can't be a peek
        // or peek-trade target anymore — drop the stale reference.
        this.scene.peekedCards = this.scene.peekedCards.filter(c => c !== card);
        card.key = key;
        this.scene.playStack.play(card);
    }

    alienCopy(key, i, j, copierId) {
        const card = this.pop(i, j);
        card.cancelDrag();
        this.scene.peekedCards = this.scene.peekedCards.filter(c => c !== card);
        card.key = key
        this.scene.playStack.play(card, true);
        const copier = copierId && this.scene.players[copierId];
        if (copier) card.highlight(copier.color);
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

    order(onComplete = () => {}, duration = 200) {
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
                    duration,
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