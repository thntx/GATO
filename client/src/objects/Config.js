const WIDTH = 1920;
const HEIGHT = 1080;

export const pos = {
    X: (percentatge) => { return WIDTH / 100 * percentatge; },
    Y: (percentatge) => { return HEIGHT / 100 * percentatge; }
}

export const cardConfig = {
    SIZE: 500,
    SCALE: 0.3,
    ALIEN_SCALE: 0.2,
    // Used in 6- and 7-player rooms where three aliens have to stack on a
    // side. Smaller cards keep the three hands from overlapping each other
    // vertically and from running into the bottom-right action log.
    SMALL_ALIEN_SCALE: 0.13,
};

export const deckConfig = {
    X: pos.X(50),
    Y: pos.Y(15),
    PER_PLAYER: 23,
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
// Three-per-side stacking for 6- and 7-player rooms. Symmetric 17% spacing
// between the three slots — tighter than the original 20% so HIGH clears
// the CAT-pile that anchors the top-left corner (cats extend to about
// pos.Y(10.5), so HIGH at 23 puts the alien's label around pos.Y(13.5)
// with a comfortable gap). LOW correspondingly creeps up to keep the row
// symmetric around MID and to leave room above the self hand (pos.Y(82),
// hand top ~67%) and the log's top edge (~69%).
const HAND_Y_HIGH = pos.Y(23);
const HAND_Y_MID = pos.Y(40);
const HAND_Y_LOW = pos.Y(57);

export const handConfig = {
    X: [[HAND_X_MAIN, HAND_X_MAIN + HAND_X_OFFSET],
        [HAND_X_MAIN, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN - HAND_X_OFFSET],
        [HAND_X_MAIN, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN - HAND_X_OFFSET],
        [HAND_X_MAIN, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN - HAND_X_OFFSET, HAND_X_MAIN - HAND_X_OFFSET],
        // 6 players: 3 aliens stacked on the right, 2 on the left.
        [HAND_X_MAIN, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN - HAND_X_OFFSET, HAND_X_MAIN - HAND_X_OFFSET],
        // 7 players: 3 stacked on each side.
        [HAND_X_MAIN, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN + HAND_X_OFFSET, HAND_X_MAIN - HAND_X_OFFSET, HAND_X_MAIN - HAND_X_OFFSET, HAND_X_MAIN - HAND_X_OFFSET]],
    Y: [[HAND_Y_MAIN, HAND_Y_CENTER],
        [HAND_Y_MAIN, HAND_Y_CENTER, HAND_Y_CENTER],
        [HAND_Y_MAIN, HAND_Y_DOWN, HAND_Y_UP, HAND_Y_CENTER],
        [HAND_Y_MAIN, HAND_Y_DOWN, HAND_Y_UP, HAND_Y_UP, HAND_Y_DOWN],
        // 6 players: turn order goes self → right (low → mid → high) → left (up → down).
        // The 3-side uses the HIGH/MID/LOW stack, but the 2-side falls back
        // to the tighter UP/DOWN positions so the two left aliens are
        // centered around the screen's vertical middle, the same way the
        // lone left alien in a 4-player game sits at CENTER between the
        // right side's UP/DOWN pair.
        [HAND_Y_MAIN, HAND_Y_LOW, HAND_Y_MID, HAND_Y_HIGH, HAND_Y_UP, HAND_Y_DOWN],
        // 7 players: turn order goes self → right (low → mid → high) → left (high → mid → low).
        [HAND_Y_MAIN, HAND_Y_LOW, HAND_Y_MID, HAND_Y_HIGH, HAND_Y_HIGH, HAND_Y_MID, HAND_Y_LOW]],
    ROWS: 2,
    MARGIN: 10,
    ALIEN_MARGIN: 5,
    SMALL_ALIEN_MARGIN: 4,
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

// Phaser rasterizes text once into a canvas-backed texture at the resolution
// set on the Text object, then samples it at draw time. Our base resolution is
// 1920x1080 and the Scale.FIT mode stretches the canvas to fill larger
// displays — text rasterized at 1x looks blurry on big screens. We rasterize
// at the actual display density (FIT scale × devicePixelRatio) so each text
// pixel maps to a real pixel. Computed once at module load; on resize the
// existing text stays at the original resolution, which is fine for the
// common case where the user opens the tab full-size and leaves it.
export const TEXT_RESOLUTION = Math.max(1, (window.innerHeight / 1080) * (window.devicePixelRatio || 1));

// Sound durations (ms). Kept in sync with server's SOUND_MS — the actor's
// client freezes its UI for these durations after a local emit so it can't
// queue the next action before its own sound finishes, and the server sleeps
// the same amount between events so all clients see sounds spaced out instead
// of overlapping. Peek covers the full peek-up + hold + peek-down visual
// (~1.4s) plus a small buffer for the unpeek sound to ring out and give the
// peeker a beat to internalize what they saw.
export const SOUND_MS = {
    play: 350,
    copy: 500,
    fail: 500,
    trade: 500,
    take: 250,
    peek: 1800
};