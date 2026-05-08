import { pos, uiConfig, cardConfig, TEXT_RESOLUTION } from './Config.js';

const ROW_H_PCT = 4.5;
const ROW_GAP = 4;
const ROW_PAD_X = 12;
// Spacing between adjacent items in a row. Sized to visually approximate a
// space character at our row font size so words look naturally separated
// after we split each text segment into per-word items for line-wrap.
const SEGMENT_GAP = 6;
const ROW_BG_ALPHA = 0.75;

// Bottom-right scrollable action log. Each entry is a row with a coloured,
// translucent background (server-blue or actor's player colour) and a sequence
// of segments — text or a card-face icon. New rows appear at the bottom and
// push older ones up; rows scrolled past the top are clipped by a geometry
// mask but live on indefinitely so the player can scroll back through history.
//
// Scrolling: mouse wheel while the pointer is inside the viewport. If the
// view is anchored at the newest entry (scrollOffset === 0), incoming rows
// stay anchored; if the player has scrolled up, the offset is bumped so the
// rows they were reading don't shift under their cursor.
export class Log {

    // Exact height needed for `rows` entries to be visible without clipping —
    // each row takes rowH plus ROW_GAP of vertical breathing room. Anything
    // beyond `rows` is fully cut off above the viewport.
    static heightForRows(rows) {
        return rows * (pos.Y(ROW_H_PCT) + ROW_GAP);
    }

    constructor(scene, x, y, w, h) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.rowH = pos.Y(ROW_H_PCT);
        this.rowStride = this.rowH + ROW_GAP;
        this.rows = [];
        this.scrollOffset = 0;

        // Container holds every row at local coordinates relative to the
        // viewport's top-left. Drawn above everything else so the log stays
        // visible during overlays.
        this.container = scene.add.container(x, y).setDepth(100);

        // Geometry mask clips children to the viewport rectangle.
        const maskG = scene.make.graphics({ x: 0, y: 0, add: false });
        maskG.fillStyle(0xffffff);
        maskG.fillRect(x, y, w, h);
        this.container.setMask(maskG.createGeometryMask());
        this.maskGraphics = maskG;

        // Hidden 2D canvas used purely to measure text width before placement.
        // Phaser's text.width post-setResolution doesn't always match the
        // rendered pixel width, which breaks the line-wrap math; the browser's
        // measureText API is unaffected by Phaser's resolution scaling so we
        // get the true on-screen width directly.
        this.measureCanvas = document.createElement('canvas');
        this.measureCtx = this.measureCanvas.getContext('2d');

        // Wheel scroll. Only triggers while the pointer is inside the
        // viewport so the rest of the table reacts to the wheel as before.
        // Max scroll is total content height minus viewport height — both
        // computed dynamically since rows can have variable heights now
        // when their text wraps to multiple lines.
        this.wheelHandler = (pointer, _objects, _dx, dy) => {
            if (pointer.x < x || pointer.x > x + w || pointer.y < y || pointer.y > y + h) return;
            const max = Math.max(0, this.totalContentHeight() - h);
            this.scrollOffset = Phaser.Math.Clamp(this.scrollOffset - dy * 0.4, 0, max);
            this.relayout();
        };
        scene.input.on('wheel', this.wheelHandler);

        scene.events.once('shutdown', () => {
            scene.input.off('wheel', this.wheelHandler);
        });
    }

    addEntry(segments, color) {
        const fontSize = this.rowH * 0.45;
        // Card icons render slightly larger than the text height so they
        // still read as "cards" rather than tiny glyphs, but small enough
        // that they don't grow the row beyond a single-line height (icon
        // overflows into the row's vertical padding instead) and don't
        // collide with the next line's text in multi-line rows.
        const iconSize = fontSize * 1.2;
        const cardScale = iconSize / cardConfig.SIZE;
        const bgW = this.w - ROW_GAP * 2;
        const innerW = bgW - ROW_PAD_X * 2;

        // Materialise each segment as a Phaser game object so we can measure
        // its width. Text uses bold sans at ~45% of the (single-line) row
        // height; card icons render at ~85% so the rank glyph stays legible.
        // Text width comes from the canvas measureText API (see constructor)
        // because Phaser's text.width is unreliable when setResolution is in
        // play. Text segments are split into per-word items so the line-wrap
        // logic can break at any word boundary, not just between top-level
        // segments — without this, a single long "<a> peeked a card from <b>"
        // segment can't wrap and overflows the viewport.
        this.measureCtx.font = `bold ${fontSize}px ${uiConfig.FONT}`;
        const items = [];
        for (const seg of segments) {
            if (seg.type === 'text') {
                const words = seg.value.trim().split(/\s+/).filter(Boolean);
                for (const word of words) {
                    const measuredW = this.measureCtx.measureText(word).width;
                    const txt = this.scene.add.text(0, 0, word, {
                        fontFamily: uiConfig.FONT,
                        fontSize: fontSize + 'px',
                        fontStyle: 'bold',
                        color: '#ffffff'
                    }).setOrigin(0, 0.5).setResolution(TEXT_RESOLUTION);
                    items.push({ obj: txt, w: measuredW, type: 'text' });
                }
            } else if (seg.type === 'card') {
                const sprite = this.scene.add.sprite(0, 0, 'cards', seg.value).setScale(cardScale);
                items.push({ obj: sprite, w: iconSize, type: 'card' });
            }
        }

        // Flow segments left-to-right; break to a new line when the next
        // segment would push us past the inner width. A segment that's
        // larger than innerW on its own still gets a line of its own and
        // overflows visually — rare with our log templates and player nicks.
        const lines = [[]];
        let curLineW = 0;
        for (const item of items) {
            const gap = lines[lines.length - 1].length > 0 ? SEGMENT_GAP : 0;
            if (lines[lines.length - 1].length > 0 && curLineW + gap + item.w > innerW) {
                lines.push([item]);
                curLineW = item.w;
            } else {
                lines[lines.length - 1].push(item);
                curLineW += gap + item.w;
            }
        }

        const numLines = lines.length;

        // Uniform line height — fontSize for every line, regardless of
        // content. Card icons (slightly taller than fontSize) overflow into
        // the row's vertical padding rather than dictating line height, so
        // a single-line row with an icon stays the same height as a
        // text-only single-line row, and a 2-line text row is exactly
        // rowH + fontSize + lineGap tall.
        const linePad = (this.rowH - fontSize) / 2;
        const lineGap = 4;
        const rowH = 2 * linePad + numLines * fontSize + (numLines - 1) * lineGap;

        // Build the row container with a background sized to fit all lines.
        // Cap the corner radius at half a single-line row's height — that's
        // the radius Phaser effectively renders for short rows (since the
        // rectangle's vertical extent clamps it) so longer rows stay
        // visually consistent with the rest.
        const row = this.scene.add.container(this.w / 2, 0);
        const bg = this.scene.add.rectangle(0, 0, bgW, rowH, color).setAlpha(ROW_BG_ALPHA);
        if (bg.setRounded) bg.setRounded(this.rowH / 2);
        row.add(bg);

        // Walk down the row from top padding, advancing by fontSize plus
        // inter-line gap per line. Each line's contents are vertically
        // centered on that line's slot.
        for (let li = 0; li < numLines; li++) {
            const lineCenterY = -rowH / 2 + linePad + fontSize / 2 + li * (fontSize + lineGap);
            let cursorX = -bgW / 2 + ROW_PAD_X;
            for (const item of lines[li]) {
                if (item.type === 'text') {
                    item.obj.x = cursorX;
                    item.obj.y = lineCenterY;
                } else {
                    item.obj.x = cursorX + item.w / 2;
                    item.obj.y = lineCenterY;
                }
                row.add(item.obj);
                cursorX += item.w + SEGMENT_GAP;
            }
        }

        row.totalH = rowH;

        // Bottom-anchor preservation: if the player is scrolled up reading
        // older entries, bump the offset by exactly the new row's stride so
        // the rows under their cursor don't shift. At the bottom anchor
        // (offset 0) we leave it alone so the new entry just appears.
        if (this.scrollOffset > 0) {
            const newStride = rowH + ROW_GAP;
            const totalAfter = this.totalContentHeight() + newStride;
            const max = Math.max(0, totalAfter - this.h);
            this.scrollOffset = Math.min(this.scrollOffset + newStride, max);
        }

        this.rows.push(row);
        this.container.add(row);
        this.relayout();
    }

    relayout() {
        // Walk newest-to-oldest, anchoring the bottom of the newest row a
        // ROW_GAP above the viewport bottom and stacking older rows above
        // (each separated by ROW_GAP). scrollOffset shifts the whole stack
        // downward so older rows come into view.
        let bottomY = this.h - ROW_GAP + this.scrollOffset;
        for (let i = this.rows.length - 1; i >= 0; i--) {
            const row = this.rows[i];
            const rowH = row.totalH || this.rowH;
            row.y = bottomY - rowH / 2;
            bottomY -= rowH + ROW_GAP;
        }
    }

    totalContentHeight() {
        let sum = 0;
        for (const row of this.rows) {
            sum += (row.totalH || this.rowH) + ROW_GAP;
        }
        return sum;
    }
}
