// "Digital rain" for the machine's screen: a 2D canvas used as a texture
// (CanvasTexture), redrawn a few times per second.
//
// Each column drops one glyph per step at its own pace. The head glyph is
// pale, the trail turns green and fades out under a translucent black fill.

import { CanvasTexture, LinearFilter } from 'three';

// Half-width katakana + digits.
const GLYPHS = Array.from({ length: 56 }, (_, i) => String.fromCharCode(0xff66 + i)).join('') + '0123456789';

const HEAD_COLOR = '#d8ffd8';
const TRAIL_COLOR = '#22e04a';
const FADE = 'rgba(0, 0, 0, 0.09)';

function randomGlyph() {
    return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

export class MatrixScreen {
    // The screen quad is 16:9.
    constructor({ width = 640, height = 360, fontSize = 18, stepMs = 50 } = {}) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.context = this.canvas.getContext('2d');
        this.fontSize = fontSize;
        this.stepMs = stepMs;
        this.rows = Math.ceil(height / fontSize);
        this.last = 0;

        this.texture = new CanvasTexture(this.canvas);
        this.texture.minFilter = LinearFilter;
        this.texture.magFilter = LinearFilter;
        this.texture.generateMipmaps = false;

        const count = Math.floor(width / fontSize);
        this.columns = Array.from({ length: count }, () => this._newColumn(true));

        this.context.fillStyle = '#000';
        this.context.fillRect(0, 0, width, height);
        // Pre-run so the screen is already full of rain on the first frame.
        for (let i = 0; i < this.rows * 3; i++) this._step();
        this.texture.needsUpdate = true;
    }

    _newColumn(scatter) {
        return {
            row: scatter ? -Math.floor(Math.random() * this.rows) : -Math.floor(Math.random() * 8),
            every: 1 + Math.floor(Math.random() * 3), // steps between drops
            wait: 0,
            glyph: randomGlyph(),
        };
    }

    // Call every frame; draws only when a step is due.
    update(time) {
        if (time - this.last < this.stepMs) return;
        this.last = time;
        this._step();
        this.texture.needsUpdate = true;
    }

    _step() {
        const { context: ctx, fontSize, canvas } = this;
        ctx.fillStyle = FADE;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = `700 ${fontSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        this.columns.forEach((column, i) => {
            if (column.wait-- > 0) return;
            column.wait = column.every - 1;

            const x = (i + 0.5) * fontSize;
            // The previous head becomes trail.
            if (column.row >= 0) {
                ctx.fillStyle = TRAIL_COLOR;
                ctx.fillText(column.glyph, x, column.row * fontSize);
            }

            column.row++;
            column.glyph = randomGlyph();
            if (column.row >= 0) {
                ctx.fillStyle = HEAD_COLOR;
                ctx.fillText(column.glyph, x, column.row * fontSize);
            }

            // Off the bottom: start again from the top, some time later.
            if (column.row > this.rows && Math.random() > 0.9) Object.assign(column, this._newColumn(false));
        });
    }
}
