<script setup>
// Alternative controllers tool.
//
// Shows every USB serial board the launcher sees, its handshake state, and
// the messages accepted boards send, exactly as the page receives them over
// IPC (see axis-launcher-electron/src/managers/AlternativeControllerManager.js).
// Machine only: in a browser the list stays empty.

import { computed, reactive, ref, onBeforeUnmount } from 'vue';
import AppHeader from '../../components/AppHeader.vue';
import InputIndicators from '../../components/InputIndicators.vue';
import { useIpc } from '../../axis/useIpc.js';

const MAX_LOG_LINES = 40;
// Rejected boards are silent by definition: poll so their state shows up.
const REFRESH_MS = 2000;

const { ready, listen } = useIpc();

const devices = ref([]); // as listed by the launcher
const lastMessage = reactive({}); // path -> data
const logLines = ref([]); // { id, path, line }
const count = ref(0);
let logId = 0;
let refreshTimer = null;

const inputs = [{ key: 'home', label: 'Tools' }];

const deviceRows = computed(() => devices.value.map((device) => ({
    device,
    ids: [device.manufacturer, device.vendorId && `${device.vendorId}:${device.productId}`, device.serialNumber && `sn ${device.serialNumber}`]
        .filter(Boolean)
        .join(' · '),
    last: lastMessage[device.path] || null,
})));

function shortPath(path) {
    return path.replace('/dev/cu.', '');
}

function log(path, line) {
    logLines.value.push({ id: logId++, path, line });
    if (logLines.value.length > MAX_LOG_LINES) logLines.value.splice(0, logLines.value.length - MAX_LOG_LINES);
}

ready((ipcRenderer) => {
    async function refresh() {
        devices.value = await ipcRenderer.invoke('alternative:list');
    }

    listen('alternative:connected', refresh);
    listen('alternative:disconnected', (event, device) => {
        delete lastMessage[device.path];
        refresh();
    });

    listen('alternative:raw', (event, { path, line }) => {
        log(path, line);
        // Candidates and rejections are not announced on their own: any line
        // from a path we do not know yet means the list changed.
        if (!devices.value.some((device) => device.path === path)) refresh();
    });

    listen('alternative:message', (event, { slot, data }) => {
        count.value++;
        const device = devices.value.find((item) => item.slot === slot);
        if (device) lastMessage[device.path] = data;
    });

    refresh();
    refreshTimer = setInterval(refresh, REFRESH_MS);
});

onBeforeUnmount(() => clearInterval(refreshTimer));
</script>

<template>
    <div class="layout">
        <AppHeader />

        <main class="view">
            <div class="heading">
                <h1 class="title">Alternative controllers</h1>
                <p class="description">Plug any USB serial board. It is pinged and has three seconds to answer with a ready line; accepted boards get a slot and their messages show up here as a game would receive them.</p>
            </div>

            <div class="panels">
                <section class="panel">
                    <h2 class="panel-title">Devices</h2>
                    <div class="devices">
                        <p v-if="!deviceRows.length" class="panel-note">Nothing plugged in yet. Boards only show up on the machine.</p>
                        <div v-for="row in deviceRows" :key="row.device.path" class="device" :class="`is-${row.device.state}`">
                            <div class="device-slot">{{ row.device.slot || '·' }}</div>
                            <div>
                                <div class="device-name">{{ row.device.name || row.device.path }}<span class="device-state">{{ row.device.state }}</span></div>
                                <div class="device-meta">{{ row.device.path }}{{ row.ids ? ' · ' + row.ids : '' }}</div>
                                <dl v-if="row.last && Object.keys(row.last).length" class="device-last">
                                    <template v-for="(value, key) in row.last" :key="key">
                                        <dt>{{ key }}</dt><dd>{{ value }}</dd>
                                    </template>
                                </dl>
                            </div>
                        </div>
                    </div>
                </section>

                <section class="panel">
                    <h2 class="panel-title">Raw lines</h2>
                    <div class="log">
                        <div v-for="entry in logLines" :key="entry.id" class="log-line"><span class="path">{{ shortPath(entry.path) }}</span>{{ entry.line }}</div>
                    </div>
                </section>
            </div>
        </main>

        <div class="footnote">Messages received: <span>{{ count }}</span></div>

        <InputIndicators :inputs="inputs" />
    </div>
</template>

<style scoped>
/* Panels */
.panels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4rem;
    min-height: 0;
}

.panel { display: grid; grid-template-rows: auto 1fr; min-height: 0; }

/* Devices */
.devices { overflow: hidden; }

.device {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.9rem 1.2rem;
    align-items: start;
    padding: 1.2rem 0;
    border-top: 1px solid var(--black-1);
}

.device-slot {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.2rem;
    height: 3.2rem;
    border-radius: 50%;
    background: var(--black-1);
    font-weight: 800;
    font-size: 1.4rem;
    color: var(--light-grey);
}

.device.is-connected .device-slot { background: var(--white); color: var(--black); }

.device-name {
    font-weight: 800;
    font-size: 1.75rem;
    line-height: 1;
}

.device-state {
    display: inline-block;
    margin-left: 0.8rem;
    padding: 0.12rem 0.5rem 0.2rem;
    border-radius: 0.8rem 0.8rem 0.8rem 0;
    background: var(--black-1);
    font-weight: 700;
    font-size: 0.8rem;
    line-height: 1;
    color: var(--light-grey);
    vertical-align: middle;
}

.device.is-connected .device-state { background: var(--white); color: var(--black); }

.device-meta {
    margin-top: 0.4rem;
    font-weight: 600;
    font-size: 1rem;
    color: var(--grey);
    font-variant-numeric: tabular-nums;
}

.device-last {
    margin-top: 0.6rem;
    display: grid;
    grid-template-columns: auto auto;
    justify-content: start;
    column-gap: 1.2rem;
    row-gap: 0.15rem;
    font-weight: 600;
    font-size: 1.1rem;
    line-height: 1.3;
    color: var(--light-grey);
    font-variant-numeric: tabular-nums;
}

.device-last dt { color: var(--grey); }

/* Raw log */
.log {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    overflow: hidden;
    font-weight: 600;
    font-size: 1rem;
    line-height: 1.5;
    color: var(--light-grey);
    font-variant-numeric: tabular-nums;
}

/* flex: none, otherwise lines that do not fit get shrunk to slivers
   instead of being clipped at the top by the panel. */
.log-line { flex: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.log-line .path { color: var(--grey); margin-right: 0.8rem; }
</style>
