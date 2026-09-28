import { anyInputActive } from './utils.js';
import { Dialog, errorDialog } from './dialog.js';
import { Model, Paste, Play, Stop } from './model.js';
import { Editor } from './editor.js';
import { AudioView } from './audioview.js';
import { TitleView } from './titleview.js';
import * as session from './session.js';
import * as sharing from './sharing.js';

// Project title input
let inputProjectTitle = document.getElementById('project_title');

// Menu buttons
let btnOpen = document.getElementById('btn_open');
let btnSave = document.getElementById('btn_save');
let btnShare = document.getElementById('btn_share');
let btnPlay = document.getElementById('btn_play');
let btnStop = document.getElementById('btn_stop');

const SLOT_INFO = [
    { slot: 0, label: 'Self Frequency' },
    { slot: 1, label: 'Self Gain' },
    { slot: 2, label: 'Cluster Chord' },
    { slot: 3, label: 'Cluster Gain' },
];

let noiseSlotSocket = null;
let noiseSlotPanel = null;
let noiseSlotState = SLOT_INFO.map((info) => ({ ...info, nodeIds: [] }));

// Project model/state
let model = new Model();

	// Graph editor view
	let editor = new Editor(model);

// Audio view of the model
let audioView = new AudioView(model);

// View that updates the webpage title
let titleView = new TitleView(model);

// Most recent location of a mouse or touch event
let cursor = { x: 0, y: 0 };

document.body.onload = async function ()
{
    //browserWarning();

    // Parse the projectId from the path
    let path = location.pathname;
    let projectId = parseInt(location.pathname.replace('/',''));

    // If a projectId was supplied
    if (!isNaN(projectId))
    {
        // Download the serialized project data
        let data = await sharing.getProject(projectId);

        // Try to import the project
        importModel(data);

        return;
    }

    // If a hash location was supplied
    if (location.hash)
    {
        if (location.hash == '#new')
        {
            model.new();

            // Avoid erasing saved state on refresh/reload
            history.replaceState(null, null, ' ');

            return;
        }

        // Note: projectIds encoded in the location hash are deprecated
        // but we will keep supporting them for a bit for backwards
        // compatibility with old URLs
        //
        // Download the serialized project data
        let projectId = location.hash.slice(1);
        let data = await sharing.getProject(projectId);

        // Try to import the project
        importModel(data);

        return;
    }

    let serializedModelData = localStorage.getItem('latestModelData');

    if (!serializedModelData)
    {
        model.new();
        return;
    }

    try
    {
        importModel(serializedModelData);
    }
    catch (e)
    {
        console.log(e.stack);

        // If loading failed, we don't want to reload
        // the same data again next time
        localStorage.removeItem('latestModelData');

        // Reset the project
        model.new();
    }
}

window.onunload = function ()
{
    // Save the graph when unloading the page
    localStorage.setItem('latestModelData', model.serialize());
}

window.onmousedown = handleMouseEvent;
window.onmousemove = handleMouseEvent;

window.onkeydown = function (event)
{
    // If a text input box is active, do nothing
    if (document.activeElement &&
        document.activeElement.nodeName.toLowerCase() == "input")
        return;

    // Spacebar triggers play/stop
    if (event.code == 'Space')
    {
        if (model.playing)
        {
            stopPlayback();
        }
        else
        {
            startPlayback();
        }

        event.preventDefault();
    }

    // Ctrl or Command key
    if (event.ctrlKey || event.metaKey)
    {
        // Ctrl + S (save)
        if (event.code == 'KeyS')
        {
            saveModelFile();
            event.preventDefault();
        }

        // Ctrl + Z (undo)
        if (event.code == 'KeyZ')
        {
            console.log('undo');
            event.preventDefault();
            model.undo();
        }

        // Ctrl + Y (redo)
        if (event.code == 'KeyY')
        {
            console.log('redo');
            event.preventDefault();
            model.redo();
        }

        // Ctrl + A (select all)
        if (event.code == 'KeyA')
        {
            event.preventDefault();
            editor.selectAll();
        }

        // Ctrl + G (group nodes)
        if (event.code == 'KeyG' && location.hostname == 'localhost')
        {
            console.log('group nodes');
            event.preventDefault();
            editor.groupSelected();
        }

        return;
    }

    // Delete or backspace key
    if (event.code == 'Backspace' || event.code == 'Delete')
    {
        console.log('delete key');
        event.preventDefault();
        editor.deleteSelected();
        return;
    }
}

document.oncopy = function (evt)
{
    if (anyInputActive())
        return;

    if (!editor.selected.length)
        return;

    let data = JSON.stringify(model.copy(editor.selected));
    evt.clipboardData.setData('text/plain', data);
    evt.preventDefault();
}

document.oncut = function (evt)
{
    if (anyInputActive())
        return;

    if (!editor.selected.length)
        return;

    let data = JSON.stringify(model.copy(editor.selected));
    evt.clipboardData.setData('text/plain', data);
    evt.preventDefault();

    editor.deleteSelected();
}

document.onpaste = function (evt)
{
    if (anyInputActive())
        return;

    try
    {
        let clipData = evt.clipboardData.getData('text/plain');
        let nodeData = JSON.parse(clipData)
        model.update(new Paste(nodeData, cursor.x, cursor.y));
        evt.preventDefault();
    }

    catch (e)
    {
        console.log(e);
    }
}

function handleMouseEvent(evt)
{
    cursor = editor.getMousePos(evt);
}

function importModel(serializedModelData)
{
    // Stop playback to avoid glitching
    stopPlayback();

    model.deserialize(serializedModelData);

    syncCurrentProject(serializedModelData);
}

async function syncCurrentProject(serializedModelData)
{
    if (typeof fetch !== 'function')
        return;

    try
    {
        await fetch('/current-project',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: serializedModelData })
        });
    }
    catch (err)
    {
        console.warn('Failed to sync current project to embed', err);
    }
}

function openModelFile()
{
    let input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ncft,.json,application/json,application/JSON';

    input.onchange = (e) =>
    {
        if (!e || !e.target || !e.target.files)
            return;

        let file = e.target.files[0];
        if (!file)
            return;

        let reader = new FileReader();
        reader.readAsText(file, 'UTF-8');

        reader.onload = (e) =>
        {
            if (!e || !e.target)
                return;

            try
            {
                importModel(e.target.result);
            }
            catch (error)
            {
                errorDialog("Failed to load project file.");
            }

            // Clear any hash tag in the URL
            history.replaceState(null, null, ' ');
        }
    };

    input.click();
}

function saveModelFile()
{
    // There is no JS API in most browsers to prompt a file download. Chrome has
    // a file system API, but as of writing other browsers have no equivalent.
    //
    // Instead, a download typically occurs when your browser opens a URL and
    // decides the content should be saved as a file (rather than displayed or
    // used in a window).
    //
    // To save our file here, we will ask the browser to open a special kind of
    // of URL that uses the blob protocol. Our URL will not point to an external
    // resource, instead it will contain all data we want the user to download.
    //
    // We can ask the browser to open our URL in a few different ways. Here, we
    // will simulate a link on the page being clicked. It's a good user
    // experience compared to opening the URL in a new tab or window, which
    // takes the user away from the current page.
    let a = document.createElement('a');

    // Generate a default save file name
    let saveFileName =`${inputProjectTitle.value || 'untitled_project'}.ncft`;
    saveFileName = saveFileName.toLowerCase();
    saveFileName = saveFileName.replace(/[^a-z0-9.]/gi, "_");

    // This is what the browser will name the download by default.
    //
    // If the browser is configured to automatically save downloads in a fixed
    // location, this will be the default name for the file. If a file already
    // exists with that name, the name will be modified to prevent a conflict
    // ("example.ncft" might become "example (1).ncft") or the user will be
    // asked what to do (replace, modify the name, or cancel the download).
    //
    // If the browser is configured to prompt the user for a save location, this
    // will be the default name in the save dialog. The user can usually change
    // the name if they would like.
    a.download = saveFileName;

    // This is the binary large object (blob) we would like to send to the user.
    let blob = new Blob(
        [model.serialize()],
        {type: 'application/json'}
    );

    // This is the URL we're asking the browser to open, which will prompt the
    // blob download.
    //
    // In major browsers, the maximum size for this URL is quite generous. It
    // should pose no problem here. See: https://stackoverflow.com/a/43816041
    a.href = window.URL.createObjectURL(blob);

    a.click();
}

	function shareProject()
	{
	    sharing.shareProject(model);
	}

	function initNoiseSlotBridge(editorInstance)
	{
	    if (typeof window === 'undefined' || !editorInstance)
	        return;

	    setupNoiseSlotPanel(editorInstance);
	    loadSocketIoClient()
	        .then(() => {
	            const slotUrl = resolveSlotServerUrl();
	            if (!slotUrl || typeof window.io !== 'function')
	                return;
	            noiseSlotSocket = window.io(slotUrl, {
	                path: '/socket',
	                transports: ['websocket'],
	                query: { type: 'noiseSlotsEditor' },
	            });
            noiseSlotSocket.on('connect', () =>
                updateSlotPanelStatus('Realtime connected')
            );
            noiseSlotSocket.on('disconnect', () =>
                updateSlotPanelStatus('Realtime disconnected')
            );
            const syncState = (payload) => updateSlotStateFromPayload(payload);
            noiseSlotSocket.on('noiseSlots:init', syncState);
            noiseSlotSocket.on('noiseSlots:update', syncState);
        })
        .catch(() => {
            updateSlotPanelStatus('Slot bridge unavailable');
        });
}

function resolveSlotServerUrl()
{
    const params = new URLSearchParams(window.location.search);
    const direct = params.get('slotUrl') || params.get('slotServer');
    if (direct)
        return direct;
    const path = params.get('slotPath') || '/socket';
    const origin = window.location;
    const isLocalHost =
        origin.hostname === 'localhost' || origin.hostname === '127.0.0.1';
    if (isLocalHost) {
        return `${origin.protocol}//${origin.hostname}:3001${path}`;
    }
    return `${origin.origin.replace(/\/$/, '')}${path}`;
}

function loadSocketIoClient()
{
    if (typeof window === 'undefined')
        return Promise.reject();
    if (window.io)
        return Promise.resolve();
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.4/socket.io.min.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('failed to load socket.io'));
        document.head.appendChild(script);
    });
}

function setupNoiseSlotPanel(editorInstance)
{
    if (noiseSlotPanel)
        return;
    const panel = document.createElement('div');
    panel.id = 'noise_slot_panel';
    panel.style.position = 'fixed';
    panel.style.right = '16px';
    panel.style.bottom = '16px';
    panel.style.width = '260px';
    panel.style.background = 'rgba(0,0,0,0.65)';
    panel.style.backdropFilter = 'blur(6px)';
    panel.style.border = '1px solid rgba(255,255,255,0.1)';
    panel.style.borderRadius = '12px';
    panel.style.padding = '12px';
    panel.style.color = '#fff';
    panel.style.fontFamily = 'Inter, Pretendard, system-ui, -apple-system, sans-serif';
    panel.style.fontSize = '12px';
    panel.style.zIndex = 9999;

    const title = document.createElement('div');
    title.textContent = 'Noise Slots';
    title.style.fontSize = '13px';
    title.style.fontWeight = '600';
    title.style.marginBottom = '8px';
    panel.appendChild(title);

    SLOT_INFO.forEach((info) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.flexDirection = 'column';
        row.style.gap = '4px';
        row.style.marginBottom = '10px';

        const label = document.createElement('div');
        label.textContent = `${info.slot + 1}. ${info.label}`;
        label.style.fontWeight = '500';
        row.appendChild(label);

        const controls = document.createElement('div');
        controls.style.display = 'flex';
        controls.style.gap = '6px';

        const assignBtn = document.createElement('button');
        assignBtn.textContent = 'Assign selection';
        assignBtn.style.flex = '1';
        assignBtn.onclick = () => assignSelectionToSlot(editorInstance, info.slot);

        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.style.flex = '0 0 auto';
        clearBtn.onclick = () => clearNoiseSlot(info.slot);

        [assignBtn, clearBtn].forEach((btn) => {
            btn.style.background = '#1f2937';
            btn.style.color = '#fff';
            btn.style.border = '1px solid rgba(255,255,255,0.2)';
            btn.style.borderRadius = '999px';
            btn.style.padding = '4px 8px';
            btn.style.cursor = 'pointer';
        });

        controls.appendChild(assignBtn);
        controls.appendChild(clearBtn);
        row.appendChild(controls);

        const meta = document.createElement('div');
        meta.className = 'noise-slot-meta';
        meta.dataset.slot = String(info.slot);
        meta.textContent = 'No nodes assigned';
        meta.style.opacity = '0.8';
        row.appendChild(meta);

        panel.appendChild(row);
    });

    const status = document.createElement('div');
    status.id = 'noise_slot_status';
    status.style.fontSize = '11px';
    status.style.opacity = '0.7';
    status.textContent = 'Connecting to realtime...';
    panel.appendChild(status);

    document.body.appendChild(panel);
    noiseSlotPanel = panel;
}

function updateSlotPanelStatus(text)
{
    const status = document.getElementById('noise_slot_status');
    if (status) {
        status.textContent = text;
    }
}

	function assignSelectionToSlot(editorInstance, slot)
	{
	    const selection = editorInstance.selected || [];
	    if (!selection.length) {
	        alert('노드를 먼저 선택해주세요.');
	        return;
	    }
	    const nodeIds = selection.map((item) =>
	        typeof item === 'string' || typeof item === 'number'
	            ? String(item)
	            : item && typeof item.id !== 'undefined'
	                ? String(item.id)
	                : null
	    ).filter((id) => typeof id === 'string' && id.length > 0);
	    if (!nodeIds.length) {
	        alert('선택한 노드에서 ID를 읽을 수 없습니다.');
	        return;
	    }
	    sendNoiseSlotUpdate(slot, nodeIds);
	    // 서버 응답을 기다리는 동안에도 즉시 패널에 반영
	    noiseSlotState = noiseSlotState.map((entry) =>
	        entry.slot === slot ? { ...entry, nodeIds } : entry
	    );
	    refreshNoiseSlotPanel();
	}

function clearNoiseSlot(slot)
{
    if (!noiseSlotSocket)
        return;
    noiseSlotSocket.emit('noiseSlots:clear', { slot });
}

function sendNoiseSlotUpdate(slot, nodeIds)
{
    if (!noiseSlotSocket) {
        alert('Realtime socket 미연결 상태입니다.');
        return;
    }
    noiseSlotSocket.emit('noiseSlots:set', { slot, nodeIds });
}

function updateSlotStateFromPayload(payload)
{
    if (!Array.isArray(payload))
        return;
    noiseSlotState = SLOT_INFO.map((info) => {
        const next = payload.find((entry) => entry && entry.slot === info.slot);
        return {
            ...info,
            nodeIds: Array.isArray(next?.nodeIds)
                ? next.nodeIds.filter((id) => typeof id === 'string')
                : [],
        };
    });
    refreshNoiseSlotPanel();
}

function refreshNoiseSlotPanel()
{
    if (!noiseSlotPanel)
        return;
    const metas = noiseSlotPanel.querySelectorAll('.noise-slot-meta');
    metas.forEach((meta) => {
        const slot = Number(meta.dataset.slot || -1);
        const entry = noiseSlotState.find((item) => item.slot === slot);
        if (!entry) {
            meta.textContent = 'No nodes assigned';
            return;
        }
        if (!entry.nodeIds.length) {
            meta.textContent = 'No nodes assigned';
        } else {
            meta.textContent = `Nodes: ${entry.nodeIds.join(', ')}`;
        }
    });
}

function startPlayback()
{
    if (model.playing)
        return;

    console.log('starting playback');

    // Hide the play button
    btnPlay.style.display = 'none';
    btnStop.style.display = 'inline-flex';

    // Send the play action to the model
    model.update(new Play());
}

function stopPlayback()
{
    if (!model.playing)
        return;

    console.log('stopping playback');

    // Hide the stop button
    btnPlay.style.display = 'inline-flex';
    btnStop.style.display = 'none';

    // Send the stop action to the model
    model.update(new Stop());
}

// Warn users that NoiseCraft works best in Chrome
function browserWarning()
{
    console.log('browserWarning');

    let agent = navigator.userAgent;

    if (agent.includes('Chrome') || agent.includes('Edge') || agent.includes('Firefox'))
        return;

    if (localStorage.getItem('displayed_browser_warning'))
        return;

    let dialog = new Dialog('Your Browser is Unsupported :(');

    dialog.paragraph(
        'NoiseCraft uses new web audio API features and works best in Chrome or Edge ' +
        'web browsers. In other web browsers, you may find that it is not yet able to ' +
        'produce audio output.'
    );

    if (agent.includes('Firefox'))
    {
        dialog.paragraph(
            'Firefox will be fully supported once this bug is resolved: ' +
            '<a href="https://bugzilla.mozilla.org/show_bug.cgi?id=1572644" target=”_blank”>' +
            'https://bugzilla.mozilla.org/show_bug.cgi?id=1572644</a>'
        );
    }

    dialog.paragraph(
        'If you have time, please consider trying NoiseCraft in Google Chrome: ' +
        '<a href="https://chrome.google.com/" target=”_blank”>' +
        'https://chrome.google.com/</a>'
    )

    var okBtn = document.createElement('button');
    okBtn.className = 'form_btn';
    okBtn.appendChild(document.createTextNode('OK'));
    okBtn.onclick = evt => dialog.close();
    dialog.appendChild(okBtn);

    localStorage.setItem('displayed_browser_warning', true);
}

btnOpen.onclick = openModelFile;
btnSave.onclick = saveModelFile;
btnShare.onclick = shareProject;
btnPlay.onclick = startPlayback;
btnStop.onclick = stopPlayback;
