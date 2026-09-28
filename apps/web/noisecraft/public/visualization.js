import { Model, Play, Stop, SetParam } from "./model.js";
import { Editor } from "./editor.js";
import { AudioView } from "./audioview.js";

const DEFAULT_SOCKET_URL = "https://intersection-game.onrender.com/socket";
const AUDIO_STATUS = document.getElementById("audio_status");
const AUDIO_DOT = document.getElementById("audio_status_dot");
const SOCKET_STATUS = document.getElementById("socket_status");
const SOCKET_DOT = document.getElementById("socket_status_dot");
const PROJECT_META = document.getElementById("project_meta");
const PROJECT_TITLE = document.getElementById("project_title");
const GRAPH_BG_TEXT = document.getElementById("graph_bg_text");
const BTN_START = document.getElementById("btn_start");
const BTN_STOP = document.getElementById("btn_stop");
const BTN_UPLOAD = document.getElementById("btn_upload");
const FILE_INPUT = document.getElementById("file_input");

const setAudioStatus = (text, ok = false) => {
  AUDIO_STATUS.textContent = `Audio: ${text}`;
  AUDIO_DOT.classList.toggle("ok", ok);
};

const setSocketStatus = (text, ok = false) => {
  SOCKET_STATUS.textContent = `Socket: ${text}`;
  SOCKET_DOT.classList.toggle("ok", ok);
};

const setProjectMeta = (title, extra = "") => {
  PROJECT_META.textContent = `Project: ${title || "Untitled"}${
    extra ? ` • ${extra}` : ""
  }`;
  PROJECT_TITLE.value = title || "";
};

const defaultProject = {
  title: "Embedded Patch",
  nodes: {
    0: {
      type: "Knob",
      name: "Freq",
      x: 40,
      y: 60,
      ins: [],
      inNames: [],
      outNames: [""],
      params: {
        minVal: 100,
        maxVal: 2000,
        value: 440,
        deviceId: null,
        controlId: null,
      },
    },
    1: {
      type: "Sine",
      name: "Sine",
      x: 190,
      y: 50,
      ins: [["0", 0], null],
      inNames: ["freq", "sync"],
      outNames: ["out"],
      params: { minVal: -1, maxVal: 1 },
    },
    2: {
      type: "AudioOut",
      name: "Out",
      x: 350,
      y: 40,
      ins: [
        ["1", 0],
        ["1", 0],
      ],
      inNames: ["left", "right"],
      outNames: [],
      params: {},
    },
  },
};

const model = new Model();
const editor = new Editor(model);

const audioView = new AudioView(model);

model.addView({
  update(state) {
    setProjectMeta(state?.title || "Untitled");
    if (GRAPH_BG_TEXT) {
      GRAPH_BG_TEXT.style.display =
        state && Object.keys(state.nodes || {}).length ? "none" : "block";
    }
  },
});

const deserializeSafely = (payload) => {
  if (!payload) return;
  if (typeof payload === "string") {
    model.deserialize(payload);
    return;
  }
  model.load(payload);
};

const loadInitialProject = async () => {
  const params = new URLSearchParams(window.location.search);
  const src = params.get("src");
  if (!src) {
    deserializeSafely(defaultProject);
    return "Default patch";
  }

  try {
    const resp = await fetch(src, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    deserializeSafely(text);
    return src;
  } catch (error) {
    console.warn("Failed to load src project, using default", error);
    deserializeSafely(defaultProject);
    return "Default patch (fallback)";
  }
};

const handleFileUpload = () => {
  FILE_INPUT?.click();
};

const readUploadedFile = (uploadEvent) => {
  const file = uploadEvent?.target?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = e?.target?.result;
      deserializeSafely(data);
      setProjectMeta(file.name.replace(/\.(ncft|json)$/i, ""), "uploaded");
    } catch (err) {
      console.error("Failed to parse uploaded project", err);
      alert(
        "프로젝트 파일을 읽을 수 없습니다. JSON / .ncft 형식을 확인하세요."
      );
    } finally {
      if (uploadEvent?.target) {
        uploadEvent.target.value = "";
      }
    }
  };
  reader.readAsText(file, "utf-8");
};

const startAudio = () => {
  if (model.playing) return;
  model.update(new Play());
  BTN_START.disabled = true;
  BTN_STOP.disabled = false;
  setAudioStatus("Playing", true);
};

const stopAudio = () => {
  if (!model.playing) return;
  model.update(new Stop());
  BTN_START.disabled = false;
  BTN_STOP.disabled = true;
  setAudioStatus("Stopped", false);
};

BTN_START?.addEventListener("click", startAudio);
BTN_STOP?.addEventListener("click", stopAudio);
BTN_UPLOAD?.addEventListener("click", handleFileUpload);
FILE_INPUT?.addEventListener("change", readUploadedFile);

const connectSocket = (ioUrl) => {
  if (!ioUrl) {
    setSocketStatus("Disabled");
    return;
  }
  const script = document.createElement("script");
  script.src = "https://cdn.socket.io/4.7.4/socket.io.min.js";
  script.onload = () => {
    try {
      const parsed = new URL(ioUrl, window.location.origin);
      const origin = `${parsed.protocol}//${parsed.host}`;
      const path =
        parsed.pathname && parsed.pathname !== "/"
          ? parsed.pathname
          : "/socket";
      // @ts-ignore
      const socket = window.io(origin, {
        transports: ["websocket"],
        path,
        query: { type: "spectator" },
      });
      socket.on("connect", () => setSocketStatus("Connected", true));
      socket.on("disconnect", () => setSocketStatus("Disconnected"));
      socket.on("param", (msg) => {
        if (!msg || msg.type !== "setParam") return;
        try {
          const nodeId = String(msg.nodeId);
          const paramName = msg.paramName;
          if (!model.state?.nodes?.[nodeId]) return;
          model.update(new SetParam(nodeId, paramName, msg.value));
        } catch (err) {
          console.warn("Failed to apply param message", err);
        }
      });
    } catch (err) {
      console.warn("Failed to open Socket.IO", err);
      setSocketStatus("Error opening socket");
    }
  };
  script.onerror = () => setSocketStatus("Socket script failed");
  document.head.appendChild(script);
};

const init = async () => {
  setAudioStatus("Idle");
  setSocketStatus("Connecting…");
  const sourceLabel = await loadInitialProject();
  setProjectMeta(model.state?.title || "Untitled", sourceLabel);
  if (GRAPH_BG_TEXT) {
    GRAPH_BG_TEXT.style.display =
      model.state && Object.keys(model.state.nodes || {}).length
        ? "none"
        : "block";
  }

  const params = new URLSearchParams(window.location.search);
  const ioParam = params.get("io") || DEFAULT_SOCKET_URL;
  connectSocket(ioParam);
};

init();

window.noiseCraftVisualization = {
  model,
  editor,
  audioView,
};
