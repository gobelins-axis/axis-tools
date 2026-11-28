// Canvas drawing of the input debugger, moved unchanged from the pre-Vue
// tools/inputs/inputs.js. The only edit: drawField writes the range text to
// field.rangeText (rendered by the template) instead of a DOM node.

// API calibration (see axis-api/src/utils/normalizeJoystickSignal.js)
export const CALIBRATION = {
    x: { min: 18, max: 840 },
    y: { min: 36, max: 867 },
};
export const ADC_MAX = 1023;
export const CHART_SAMPLES = 300;
export const ALT_WINDOW_MS = 5000;

export function drawJoystick(view) {
    const ctx = view.canvas.getContext('2d');
    const W = view.canvas.width;
    const H = view.canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const R = W / 2 - 12;
    const deadzone = view.joystick.deadzone;
    const threshold = view.joystick.threshold;

    ctx.clearRect(0, 0, W, H);

    // Quickmove bands (edges of the ±1 square)
    ctx.fillStyle = 'rgba(255, 213, 79, 0.35)';
    const band = R * threshold;
    ctx.fillRect(cx - R, cy - R, band, 2 * R);          // left
    ctx.fillRect(cx + R - band, cy - R, band, 2 * R);   // right
    ctx.fillRect(cx - R, cy - R, 2 * R, band);          // up
    ctx.fillRect(cx - R, cy + R - band, 2 * R, band);   // down

    // ±1 square
    ctx.strokeStyle = '#ccc';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.setLineDash([]);

    // Unit circle (magnitude is clamped to 1 by the API)
    ctx.strokeStyle = '#999';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // Deadzone
    ctx.fillStyle = 'rgba(211, 47, 47, 0.12)';
    ctx.strokeStyle = 'rgba(211, 47, 47, 0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, R * deadzone, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Crosshair
    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();

    // Raw position (full ADC range mapped to the square), hollow gray
    if (view.raw) {
        const rx = cx + ((view.raw.x / ADC_MAX) * 2 - 1) * R;
        const ry = cy - ((view.raw.y / ADC_MAX) * 2 - 1) * R;
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(rx, ry, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
    }

    // Trail
    if (view.trail.length > 1) {
        for (let i = 1; i < view.trail.length; i++) {
            const a = view.trail[i - 1];
            const b = view.trail[i];
            ctx.strokeStyle = `rgba(25, 118, 210, ${(i / view.trail.length) * 0.6})`;
            ctx.beginPath();
            ctx.moveTo(cx + a.x * R, cy - a.y * R);
            ctx.lineTo(cx + b.x * R, cy - b.y * R);
            ctx.stroke();
        }
    }

    // Normalized position
    const nx = cx + view.normalized.x * R;
    const ny = cy - view.normalized.y * R;
    ctx.strokeStyle = '#1976d2';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    ctx.fillStyle = '#1976d2';
    ctx.beginPath();
    ctx.arc(nx, ny, 6, 0, Math.PI * 2);
    ctx.fill();

    // Legend
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.fillText('blue: game  ring: raw', 4, H - 4);
}

export function drawChart(view) {
    const ctx = view.chart.getContext('2d');
    const W = view.chart.width;
    const H = view.chart.height;
    const hasRaw = view.samples.some((s) => s.rx !== null);

    ctx.clearRect(0, 0, W, H);

    const toY = hasRaw
        ? (v) => H - (v / ADC_MAX) * H
        : (v) => H / 2 - v * (H / 2 - 4);

    // Reference lines
    ctx.setLineDash([3, 3]);
    if (hasRaw) {
        ctx.strokeStyle = 'rgba(25, 118, 210, 0.5)';
        hline(ctx, toY(CALIBRATION.x.min), W);
        hline(ctx, toY(CALIBRATION.x.max), W);
        ctx.strokeStyle = 'rgba(211, 47, 47, 0.5)';
        hline(ctx, toY(CALIBRATION.y.min), W);
        hline(ctx, toY(CALIBRATION.y.max), W);
    } else {
        ctx.strokeStyle = '#ccc';
        hline(ctx, toY(1), W);
        hline(ctx, toY(-1), W);
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ddd';
    hline(ctx, toY(hasRaw ? ADC_MAX / 2 : 0), W);

    // Series
    const n = view.samples.length;
    if (n < 2) return;
    const step = W / (CHART_SAMPLES - 1);
    const offset = W - (n - 1) * step;

    plot(ctx, view.samples, hasRaw ? 'rx' : 'nx', '#1976d2', step, offset, toY);
    plot(ctx, view.samples, hasRaw ? 'ry' : 'ny', '#d32f2f', step, offset, toY);

    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.fillText(hasRaw ? 'raw 0–1023' : 'normalized -1..1', 4, 10);
}

function hline(ctx, y, W, x0 = 0) {
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
}

function plot(ctx, samples, key, color, step, offset, toY) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < samples.length; i++) {
        const v = samples[i][key];
        if (v === null || v === undefined) { started = false; continue; }
        const x = offset + i * step;
        if (!started) { ctx.moveTo(x, toY(v)); started = true; } else ctx.lineTo(x, toY(v));
    }
    ctx.stroke();
    ctx.lineWidth = 1;
}

export function rangeText(min, max, cal) {
    const flag = (min < cal.min || max > cal.max) ? ' ⚠ out of cal' : '';
    return `${min} / ${max}${flag}`;
}

// Matches the canvas buffer to its CSS size (and the screen's pixel ratio), so
// the chart is never stretched and the dot stays round.
export function fitCanvas(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * ratio) || canvas.height !== Math.round(H * ratio)) {
        canvas.width = Math.round(W * ratio);
        canvas.height = Math.round(H * ratio);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, W, H };
}

export function drawField(field, now) {
    const { ctx, W, H } = fitCanvas(field.canvas);
    ctx.clearRect(0, 0, W, H);

    // Keep the last sample before the window: it is the value at its left edge.
    const start = now - ALT_WINDOW_MS;
    while (field.samples.length > 1 && field.samples[1].t < start) field.samples.shift();
    if (!field.samples.length) return;

    // Scale to everything seen since connection, with a margin.
    let { min, max } = field;
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.15;
    const toY = (v) => H - ((v - (min - pad)) / (max - min + 2 * pad)) * H;
    // "Now" sits in the middle; the left half is the last ALT_WINDOW_MS.
    const center = W / 2;
    const toX = (t) => center - ((now - t) / ALT_WINDOW_MS) * center;

    // Zero line when it is in range, and the "now" marker
    ctx.strokeStyle = '#e4e4e4';
    if (min < 0 && max > 0) hline(ctx, toY(0), W);
    ctx.beginPath();
    ctx.moveTo(center, 0);
    ctx.lineTo(center, H);
    ctx.stroke();

    // Step line: boards send on change, so a value holds until the next one.
    ctx.strokeStyle = '#1976d2';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let lastY = null;
    for (const sample of field.samples) {
        const x = Math.max(0, toX(sample.t));
        const y = toY(sample.v);
        if (lastY === null) ctx.moveTo(x, y);
        else { ctx.lineTo(x, lastY); ctx.lineTo(x, y); }
        lastY = y;
    }
    ctx.lineTo(center, lastY);
    ctx.stroke();

    // Current level carried to the right edge, faint, to read it against the axis.
    ctx.strokeStyle = 'rgba(25, 118, 210, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    hline(ctx, lastY, W, center);
    ctx.setLineDash([]);

    // Current value
    ctx.fillStyle = '#1976d2';
    ctx.beginPath();
    ctx.arc(center, lastY, 3, 0, Math.PI * 2);
    ctx.fill();

    field.rangeText = `min ${field.min} · max ${field.max}`;
}
