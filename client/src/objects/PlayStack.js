import { Card } from './Card.js'
import { Button } from './Button.js'
import { pos, playConfig, deckConfig, cardConfig, handConfig } from './Config.js'

export class PlayStack {

    constructor(scene, x = playConfig.X, y = playConfig.Y) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.array = [];
        this.cats = 0;
        this.topIsCopy = false;

        this.setDefaultCard();
        this.setCopyIndicator();
    }

    setCopyIndicator() {
        const cardSize = pos.Y(6);
        const cardScale = cardSize / cardConfig.SIZE;
        const offset = cardSize / 2;
        const x = this.x - pos.Y(9);
        const y = this.y - pos.Y(9);

        const bottom = this.scene.add.sprite(-offset / 2, offset / 2, 'cards', 12).setScale(cardScale);
        const top = this.scene.add.sprite(offset / 2, -offset / 2, 'cards', 12).setScale(cardScale);
        this.copyIndicator = this.scene.add.container(x, y, [bottom, top])
            .setVisible(false)
            .setDepth(-1);
    }

    play(card, isCopyAttempt = false) {

        const newTopIsCopy = isCopyAttempt && card.key !== 11
            && this.topCard && this.topCard.key === card.key
            && !this.topIsCopy;

        // If the local player is mid-drag on the current top of the playstack
        // (idle fidgeting, not an actual play) when a new card arrives,
        // cancel the drag and tween the displaced card back to the playstack
        // slot. Otherwise dragend would fire back() to its saved oX/oY (=
        // playstack position) AFTER the new card has landed there, leaving
        // the old card visibly stuck on top of the new top with no working
        // listeners — its draggable was just turned off as it became
        // bottomCard.
        if (this.topCard && this.topCard.dragging) {
            const displaced = this.topCard;
            displaced.cancelDrag();
            displaced.tween({
                x: this.x,
                y: this.y,
                duration: 200,
                ease: 'Quart.out'
            });
        }

        // Capture whether the previous top was an active drop zone — i.e.
        // the local player is mid-drag with the playstack as a valid drop
        // target. We have to carry that state to the new top once it lands,
        // otherwise the alien's play silently nukes the player's drop
        // target and they have to release + re-grab to restore it.
        const wasDropZone = !!(this.topCard && this.topCard.input && this.topCard.input.dropZone);

        this.array.push(card);

        this.topCard = this.array[this.array.length - 1];
        this.bottomCard = this.array[this.array.length - 2];

        card.setDraggable(false);

        card.type = 'play';
        card.oScale = cardConfig.SCALE;
        card.setDepth(1);

        if (this.bottomCard) {
            this.bottomCard.setDraggable(false);
            // The old top's drop-zone clear is deferred to the new top's
            // tween onComplete — for the 200ms the new card is animating
            // in, the old top stays at the playstack centre acting as the
            // valid drop target so the player's in-flight drag doesn't lose
            // its zone mid-air.
        }

        this.topIsCopy = newTopIsCopy;
        this.copyIndicator.setVisible(this.topIsCopy);

        card.tween({
            x: this.x,
            y: this.y,
            scaleX: cardConfig.SCALE,
            scaleY: cardConfig.SCALE,
            alpha: 1,
            duration: 200,
            ease: 'Quart.out',
            onComplete: () => {
                card.flip(true)
                    .setDepth(0);
                // Display-list order is the tiebreaker for same-depth
                // sprites and otherwise reflects arbitrary deck-init order,
                // so older playstack cards can render above newer ones.
                // Force the freshly landed top to the end of the list so the
                // visual stack matches the logical stack.
                this.scene.children.bringToTop(card);
                this.setDragEvents();
                // Hand the drop-zone baton over: enable on new top if the
                // user was using the playstack, then clear the old top.
                if (wasDropZone) {
                    card.setDropZone(true);
                }
                if (this.bottomCard) {
                    this.bottomCard.setDropZone(false);
                }
            }
        });
    }
    
    alienPlay(key) {
        const card = this.scene.deckStack.alienHoldCard;
        this.scene.deckStack.alienHoldCard = null;
        this.scene.deckStack.alienHoldId = null;
        card.key = key;
        this.play(card);
    }

    reshuffle() {

        const deck = this.array.splice(1, Math.max(0, this.array.length - 3));

        const catCardW = cardConfig.SIZE * cardConfig.ALIEN_SCALE;
        const catStride = catCardW + handConfig.ALIEN_MARGIN;
        const catStartY = pos.Y(6);
        const catStartX = catStartY;

        const deckCards = [];
        for (const card of deck) {
            // Same rationale as DeckStack.pushAll's clearTint — any lingering
            // highlight/tint on a playstack card has to be torn down before
            // it migrates somewhere new, or the color-replace pipeline rides
            // along on the destination.
            card.clearTint();
            if (card.key == 11) {
                card.setFrame(card.key);
                card.scaleX = card.oScale;
                card.tween({
                    x: catStartX + this.cats * catStride,
                    y: catStartY,
                    scaleX: cardConfig.ALIEN_SCALE,
                    scaleY: cardConfig.ALIEN_SCALE,
                    duration: 200,
                    ease: 'Quart.out'
                });
                this.cats++;
            } else {
                deckCards.push(card);
            }
        }

        this.scene.deckStack.pushAll(deckCards);

    }

    setDragEvents() {
        const card = this.topCard;

        card.removeAllListeners();

        card.setDraggable(true);

        card.on('pointerdown', () => {

            if (!card.draggable) return;
            card.dragging = true;

            card.setDepth(2);
            card.oX = card.x;
            card.oY = card.y;

        });

        card.on('drag', (pointer, dragX, dragY) => {

            if (!card.dragging) return;

            card.setPosition(dragX, dragY);

        });


        card.on('dragend', () => {

            if (!card.dragging) return;
            card.dragging = false;

            card.setDepth(0);

            card.back();

        });
    }

    setDefaultCard() {
        this.topCard = new Card(this.scene, this.x, this.y, cardConfig.SCALE, null, 'play', false);
        this.array.push(this.topCard);
    }

    setDropZone(bool) {
        this.topCard.setDropZone(bool);
    }
}