import { Card } from './Card.js'
import { Button } from './Button.js'
import { pos, playConfig, deckConfig, cardConfig, handConfig } from './Config.js'

export class PlayStack {

    constructor(scene) {
        this.scene = scene;
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
        const x = playConfig.X - pos.Y(9);
        const y = playConfig.Y - pos.Y(9);

        const bottom = this.scene.add.sprite(-offset / 2, offset / 2, 'cards', 12).setScale(cardScale);
        const top = this.scene.add.sprite(offset / 2, -offset / 2, 'cards', 12).setScale(cardScale);
        this.copyIndicator = this.scene.add.container(x, y, [bottom, top])
            .setVisible(false)
            .setDepth(2);
    }

    play(card, isCopyAttempt = false) {

        const newTopIsCopy = isCopyAttempt && card.key !== 11
            && this.topCard && this.topCard.key === card.key
            && !this.topIsCopy;

        this.array.push(card);

        this.topCard = this.array[this.array.length - 1];
        this.bottomCard = this.array[this.array.length - 2];

        card.setDraggable(false);

        card.type = 'play';
        card.oScale = cardConfig.SCALE;
        card.setDepth(1);

        if (this.bottomCard) {
            this.bottomCard.setDraggable(false);
            this.bottomCard.setDropZone(false);
        }

        this.topIsCopy = newTopIsCopy;
        this.copyIndicator.setVisible(this.topIsCopy);

        card.tween({
            x: playConfig.X,
            y: playConfig.Y,
            scaleX: cardConfig.SCALE,
            scaleY: cardConfig.SCALE,
            alpha: 1,
            duration: 200,
            ease: 'Quart.out',
            onComplete: () => {
                card.flip(true)
                    .setDepth(0);
                this.setDragEvents();
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
        this.topCard = new Card(this.scene, playConfig.X, playConfig.Y, cardConfig.SCALE, null, 'play', false);
        this.array.push(this.topCard);
    }

    setDropZone(bool) {
        this.topCard.setDropZone(bool);
    }
}