const WIDTH = 1920;
const HEIGHT = 1080;

export const pos = {
    X: (percentatge) => { return WIDTH / 100 * percentatge; },
    Y: (percentatge) => { return HEIGHT / 100 * percentatge; }
}

export const cardConfig = {
    SIZE: 1000,
    SCALE: 0.15,
    ALIEN_SCALE: 0.1,
};

export const deckConfig = {
    X: pos.X(50),
    Y: pos.Y(15),
    LENGTH: 92,
};

export const playConfig = {
    X: pos.X(50),
    Y: pos.Y(45),
};

const HAND_X_MAIN = pos.X(50);
const HAND_X_OFFSET = pos.X(30);
const HAND_Y_MAIN = pos.Y(82);
const HAND_Y_UP = pos.Y(25);
const HAND_Y_CENTER = pos.Y(40);
const HAND_Y_DOWN = pos.Y(55);

export const handConfig = {
    X: [[HAND_X_MAIN, HAND_X_MAIN + HAND_X_OFFSET], 
        [HAND_X_MAIN, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN - HAND_X_OFFSET], 
        [HAND_X_MAIN, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN - HAND_X_OFFSET], 
        [HAND_X_MAIN, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN - HAND_X_OFFSET, HAND_X_MAIN - HAND_X_OFFSET]],
    Y: [[HAND_Y_MAIN, HAND_Y_CENTER], 
        [HAND_Y_MAIN, HAND_Y_CENTER, HAND_Y_CENTER], 
        [HAND_Y_MAIN, HAND_Y_DOWN, HAND_Y_UP, HAND_Y_CENTER], 
        [HAND_Y_MAIN, HAND_Y_DOWN, HAND_Y_UP, HAND_Y_UP, HAND_Y_DOWN]],
    ROWS: 2,
    MARGIN: 10,
    ALIEN_MARGIN: 5,
    LABEL_W: pos.X(30),
    LABEL_H: pos.Y(15),
    LABEL_Y_OFFSET: pos.Y(15)
};

export const uiConfig = {
    FONT: 'Arial',
    COLOR: 0x00a6ed,
    COLOR_STRING: '#00a6ed',
    BABEL: 90,
    SELECTED_ALPHA: 0.5,
};