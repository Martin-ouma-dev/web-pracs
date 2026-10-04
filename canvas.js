/*window.addEventListener("load", ()=>{
    const Canvas = document.querySelector("#Canvas");
    const ctx = Canvas.getContext("2d");

    Canvas.height=window.innerHeight;
    Canvas.width=window.innerWidth;


    ctx.fillStyle = "aqua";
    ctx.fillRect(200, 100, 200, 200);
    ctx.strokeStyle = "red";
    ctx.strokeRect(200, 100, 200, 200);
    ctx.beginPath();
    ctx.arc(300, 200, 100, 0, Math.PI * 2);
    ctx.strokeStyle = "blue";
    ctx.stroke();
} )*/

window.addEventListener("load", ()=>{
    const canvas = document.querySelector("#Canvas");
    const ctx = canvas.getContext("2d");
    const undoButton = document.querySelector("#undo");
    const colorButtons = document.querySelectorAll(".color-button");
    const customColor = document.querySelector("#custom-color");
    const customPencil = document.querySelector(".custom-color-button .pencil-icon");
    const brushSize = document.querySelector("#brush-size");
    const brushSizeValue = document.querySelector("#brush-size-value");
    const recognitionMode = document.querySelector("#recognition-mode");
    const speechButton = document.querySelector("#speech-input");
    const speechButtonLabel = speechButton.querySelector("span");
    const speechStatus = document.querySelector("#speech-status");
    const clearButton = document.querySelector("#clear");
    const recognizedText = document.querySelector("#recognized-text");
    const recognitionStatus = document.querySelector("#recognition-status");
    const recognizedDisplay = document.querySelector("#recognized-display");
    const writingStage = document.querySelector(".writing-stage");
    const strokes = [];
    let currentColor = "#000000";
    let activeStroke = null;
    let recognitionWorker = null;
    let recognitionWorkerPromise = null;
    let recognitionTimer = null;
    let recognitionVersion = 0;
    let handwritingWorker = null;
    let handwritingRequestId = 0;
    const handwritingRequests = new Map();
    let speechWorker = null;
    let speechWorkerRequestId = 0;
    let speechWorkerVersion = 0;
    let speechRequestVersion = 0;
    let speechRecorder = null;
    let speechStream = null;
    let speechChunks = [];
    let speechQueue = [];
    let speechSegmentTimer = null;
    let speechActive = false;
    let speechStopRequested = false;
    let speechStarting = false;
    let speechTranscribing = false;

    function resizeCanvas() {
        const pixelRatio = window.devicePixelRatio || 1;
        const width = Math.round(canvas.clientWidth * pixelRatio);
        const height = Math.round(canvas.clientHeight * pixelRatio);
        if (width === 0 || height === 0) return;
        if (canvas.width === width && canvas.height === height) return;

        canvas.width = width;
        canvas.height = height;
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        redraw();
    }

    function drawStroke(stroke) {
        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const [firstPoint, ...remainingPoints] = stroke.points;
        if (!firstPoint) return;

        ctx.moveTo(firstPoint.x, firstPoint.y);
        for (const point of remainingPoints) {
            ctx.lineTo(point.x, point.y);
        }

        if (remainingPoints.length === 0) {
            ctx.arc(firstPoint.x, firstPoint.y, ctx.lineWidth / 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.stroke();
        }
    }

    function redraw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const stroke of strokes) {
            drawStroke(stroke);
        }
    }

    function updateUndoButton() {
        const hasContent = strokes.length > 0 || recognizedText.value.trim().length > 0;
        undoButton.disabled = !hasContent;
        clearButton.disabled = !hasContent;
    }

    function updateTranscriptDisplay() {
        const hasTranscript = recognizedText.value.trim().length > 0;
        recognizedDisplay.hidden = !hasTranscript;
        writingStage.classList.toggle("has-transcript", hasTranscript);
    }

    function selectColor(color) {
        currentColor = color;
        for (const button of colorButtons) {
            button.setAttribute("aria-pressed", String(button.dataset.color === color));
        }
    }

    function startPosition(e) {
        window.clearTimeout(recognitionTimer);
        recognitionVersion++;
        canvas.hidden = false;
        activeStroke = { color: currentColor, width: Number(brushSize.value), points: [] };
        strokes.push(activeStroke);
        updateUndoButton();
        canvas.setPointerCapture(e.pointerId);
        const bounds = canvas.getBoundingClientRect();
        activeStroke.points.push({
            x: e.clientX - bounds.left,
            y: e.clientY - bounds.top
        });
        drawStroke(activeStroke);
    }

    function finishedPosition() {
        if (activeStroke) {
            scheduleRecognition();
        }
        activeStroke = null;
    }

    function draw(e) {
        if (!activeStroke) return;

        const bounds = canvas.getBoundingClientRect();
        activeStroke.points.push({
            x: e.clientX - bounds.left,
            y: e.clientY - bounds.top
        });
        drawStroke(activeStroke);
    }

    function createRecognitionImage() {
        const points = strokes.flatMap(stroke => stroke.points.map(point => ({
            x: point.x,
            y: point.y,
            padding: stroke.width / 2
        })));
        const margin = 18;
        const left = Math.max(0, Math.floor(Math.min(...points.map(point => point.x - point.padding)) - margin));
        const top = Math.max(0, Math.floor(Math.min(...points.map(point => point.y - point.padding)) - margin));
        const right = Math.min(canvas.clientWidth, Math.ceil(Math.max(...points.map(point => point.x + point.padding)) + margin));
        const bottom = Math.min(canvas.clientHeight, Math.ceil(Math.max(...points.map(point => point.y + point.padding)) + margin));
        const scale = 3;
        const image = document.createElement("canvas");
        image.width = Math.max(1, (right - left) * scale);
        image.height = Math.max(1, (bottom - top) * scale);
        const imageContext = image.getContext("2d", { willReadFrequently: true });
        imageContext.fillStyle = "#fff";
        imageContext.fillRect(0, 0, image.width, image.height);
        imageContext.drawImage(
            canvas,
            0, 0, canvas.width, canvas.height,
            -left * scale, -top * scale,
            canvas.clientWidth * scale, canvas.clientHeight * scale
        );

        const pixels = imageContext.getImageData(0, 0, image.width, image.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
            const darkestChannel = Math.min(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
            const value = darkestChannel < 215 ? 0 : 255;
            pixels.data[i] = value;
            pixels.data[i + 1] = value;
            pixels.data[i + 2] = value;
        }
        imageContext.putImageData(pixels, 0, 0);
        return image;
    }

    function getHandwritingWorker() {
        if (handwritingWorker) return handwritingWorker;

        handwritingWorker = new Worker(
            new URL("handwriting-worker.js", document.baseURI),
            { type: "module" }
        );
        handwritingWorker.addEventListener("message", event => {
            const { type, id, status, progress, text, message } = event.data;
            const request = handwritingRequests.get(id);

            if (type === "progress") {
                if (request && request.version === recognitionVersion && status) {
                    const percent = Number.isFinite(progress)
                        ? ` ${Math.min(100, Math.max(0, Math.round(progress * 100)))}%`
                        : "";
                    recognitionStatus.textContent = `${status}${percent}`;
                }
                return;
            }

            if (!request) return;
            handwritingRequests.delete(id);
            if (type === "result") {
                request.resolve(text);
            } else {
                request.reject(new Error(message));
            }
        });
        handwritingWorker.addEventListener("error", event => {
            for (const request of handwritingRequests.values()) {
                request.reject(event.error || new Error(event.message));
            }
            handwritingRequests.clear();
            handwritingWorker = null;
        });
        return handwritingWorker;
    }

    async function recognizeHandwriting(image, version) {
        const blob = await new Promise((resolve, reject) => {
            image.toBlob(result => {
                if (result) {
                    resolve(result);
                } else {
                    reject(new Error("Could not prepare the handwriting image."));
                }
            }, "image/png");
        });
        const worker = getHandwritingWorker();
        const id = ++handwritingRequestId;
        return new Promise((resolve, reject) => {
            handwritingRequests.set(id, { resolve, reject, version });
            worker.postMessage({ id, image: blob });
        });
    }

    async function ensureTesseractWorker(version) {
        if (!recognitionWorker && !recognitionWorkerPromise) {
            if (!window.Tesseract) {
                throw new Error("The OCR fallback library did not load.");
            }
            recognitionStatus.textContent = "Loading the on-device OCR fallback…";
            recognitionWorkerPromise = (async () => {
                const worker = await Tesseract.createWorker("eng", 1, {
                    logger: progress => {
                        if (version === recognitionVersion && progress.status) {
                            const percent = Number.isFinite(progress.progress)
                                ? ` ${Math.min(100, Math.max(0, Math.round(progress.progress * 100)))}%`
                                : "";
                            recognitionStatus.textContent = `Loading OCR fallback: ${progress.status}${percent}`;
                        }
                    }
                });
                await worker.setParameters({
                    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
                    preserve_interword_spaces: "1",
                    load_system_dawg: "0",
                    load_freq_dawg: "0"
                });
                return worker;
            })();
        }
        if (!recognitionWorker) {
            try {
                recognitionWorker = await recognitionWorkerPromise;
            } finally {
                recognitionWorkerPromise = null;
            }
        }
        return recognitionWorker;
    }

    async function recognizeWithTesseract(image, version, mode) {
        const worker = await ensureTesseractWorker(version);
        if (version !== recognitionVersion) return "";

        const allowedCharacters = {
            text: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,?!'-",
            numbers: "0123456789.,-/%: "
        };
        await worker.setParameters({
            tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
            preserve_interword_spaces: "1",
            load_system_dawg: "0",
            load_freq_dawg: "0",
            tessedit_char_whitelist: allowedCharacters[mode] || ""
        });
        const result = await worker.recognize(image);
        if (version !== recognitionVersion) return "";

        const wordConfidences = (result.data.words || [])
            .filter(word => word.text.trim())
            .map(word => Number(word.confidence))
            .filter(Number.isFinite);
        const confidence = wordConfidences.length
            ? Math.min(...wordConfidences)
            : Number(result.data.confidence);
        if (!Number.isFinite(confidence) || confidence < 60) {
            const confidenceText = Number.isFinite(confidence)
                ? ` (${Math.round(confidence)}% confidence)`
                : "";
            recognitionStatus.textContent = `Uncertain reading${confidenceText}; kept the handwriting instead of guessing.`;
            return "";
        }
        return result.data.text.trim();
    }

    async function recognizeWriting(version) {
        try {
            if (version !== recognitionVersion || strokes.length === 0) return;
            const image = createRecognitionImage();
            let text;

            if (recognitionMode.value === "numbers") {
                recognitionStatus.textContent = "Reading numbers on this device…";
                text = await recognizeWithTesseract(image, version, "numbers");
            } else {
                recognitionStatus.textContent = "Reading handwriting with the on-device model…";
                try {
                    text = await recognizeHandwriting(image, version);
                } catch (error) {
                    if (version !== recognitionVersion) return;
                    console.error("Handwriting model unavailable; using OCR fallback:", error);
                    recognitionStatus.textContent = "Handwriting model unavailable; trying OCR fallback…";
                    text = await recognizeWithTesseract(image, version, recognitionMode.value);
                }
            }

            if (version !== recognitionVersion) return;
            if (!text) {
                if (recognitionStatus.textContent.startsWith("Reading")) {
                    recognitionStatus.textContent = "No text detected. Try writing larger, one line at a time.";
                }
                return;
            }

            recognizedText.value = [recognizedText.value.trim(), text].filter(Boolean).join("\n");
            strokes.length = 0;
            redraw();
            updateTranscriptDisplay();
            updateUndoButton();
            recognitionStatus.textContent = "Recognized on this device. Review the result for accuracy, then write another line.";
        } catch (error) {
            recognitionWorker = null;
            recognitionWorkerPromise = null;
            recognitionStatus.textContent = "Recognition failed. Use this page through VS Code Live Server with internet access, then try again.";
            console.error("On-device handwriting recognition failed:", error);
        }
    }

    function scheduleRecognition() {
        window.clearTimeout(recognitionTimer);
        const version = ++recognitionVersion;
        recognitionTimer = window.setTimeout(() => recognizeWriting(version), 1200);
        recognitionStatus.textContent = "Recognizing when you finish writing…";
    }

    function setSpeechActive(active) {
        speechActive = active;
        speechButton.setAttribute("aria-pressed", String(active));
        speechButtonLabel.textContent = active ? "Stop recording" : "Record speech";
    }

    function cancelVoiceInput(statusMessage) {
        speechRequestVersion++;
        speechStarting = false;
        speechTranscribing = false;
        speechQueue = [];
        window.clearInterval(speechSegmentTimer);
        speechSegmentTimer = null;
        speechButton.disabled = false;
        setSpeechActive(false);
        if (speechRecorder && speechRecorder.state !== "inactive") {
            speechRecorder.stop();
        } else {
            speechStream?.getTracks().forEach(track => track.stop());
            speechStream = null;
            speechRecorder = null;
        }
        speechStatus.textContent = statusMessage;
    }

    function appendSpeechText(text) {
        const separator = recognizedText.value && !/\s$/.test(recognizedText.value) ? " " : "";
        recognizedText.value = `${recognizedText.value}${separator}${text}`;
        recognizedText.setSelectionRange(recognizedText.value.length, recognizedText.value.length);
        recognizedText.scrollTop = recognizedText.scrollHeight;
        updateTranscriptDisplay();
        updateUndoButton();
    }

    function getSpeechWorker() {
        if (speechWorker) return speechWorker;

        speechWorker = new Worker(
            new URL("speech-worker.js", document.baseURI),
            { type: "module" }
        );
        speechWorker.addEventListener("message", event => {
            const { type, id, status, progress, text, message } = event.data;
            if (id !== speechWorkerRequestId || speechWorkerVersion !== speechRequestVersion) return;

            if (type === "progress") {
                if (status) {
                    const percent = Number.isFinite(progress)
                        ? ` ${Math.min(100, Math.max(0, Math.round(progress * 100)))}%`
                        : "";
                    speechStatus.textContent = `Preparing offline speech recognition: ${status}${percent}`;
                }
                return;
            }

            speechTranscribing = false;
            if (type === "result") {
                if (text) {
                    appendSpeechText(text);
                    speechStatus.textContent = speechActive
                        ? "Listening… recognized speech is appearing in the text box."
                        : "Speech transcribed on this device. Review or edit the text.";
                } else if (!speechActive) {
                    speechStatus.textContent = "No speech detected. Try recording again.";
                }
            } else {
                speechStatus.textContent = `Speech transcription failed: ${message}`;
                console.error("Offline speech transcription failed:", message);
            }
            processSpeechQueue();
            speechButton.disabled = speechTranscribing || speechQueue.length > 0;
            if (!speechActive && !speechTranscribing && speechQueue.length === 0
                && type === "result" && text) {
                speechStatus.textContent = "Speech transcribed on this device. Review or edit the text.";
            }
        });
        speechWorker.addEventListener("error", event => {
            speechTranscribing = false;
            speechStatus.textContent = `Offline speech recognition could not start: ${event.message}`;
            speechWorker = null;
            console.error("Offline speech worker failed:", event.message);
            processSpeechQueue();
            speechButton.disabled = speechTranscribing || speechQueue.length > 0;
        });
        return speechWorker;
    }

    function processSpeechQueue() {
        if (speechTranscribing || speechQueue.length === 0) return;
        const { blob, version } = speechQueue.shift();
        if (version !== speechRequestVersion) {
            processSpeechQueue();
            return;
        }
        speechTranscribing = true;
        transcribeSpeechRecording(blob, version);
    }

    async function transcribeSpeechRecording(blob, version) {
        let audioContext;
        try {
            if (!speechActive) speechStatus.textContent = "Preparing recorded speech…";
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) {
                throw new Error("This browser does not support audio processing.");
            }
            audioContext = new AudioContextClass();
            const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
            const sampleRate = 16000;
            const outputLength = Math.ceil(decoded.duration * sampleRate);
            const mono = new Float32Array(outputLength);

            for (let i = 0; i < outputLength; i++) {
                const sourcePosition = i * decoded.sampleRate / sampleRate;
                const sourceIndex = Math.floor(sourcePosition);
                const fraction = sourcePosition - sourceIndex;
                let sample = 0;
                for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
                    const samples = decoded.getChannelData(channel);
                    const first = samples[sourceIndex] || 0;
                    const second = samples[sourceIndex + 1] || first;
                    sample += first + (second - first) * fraction;
                }
                mono[i] = sample / decoded.numberOfChannels;
            }
            await audioContext.close();
            audioContext = null;
            if (version !== speechRequestVersion) return;

            speechStatus.textContent = speechActive && !speechStopRequested
                ? "Listening… transcribing recent speech on this device."
                : "Transcribing the final speech segment on this device.";
            const id = ++speechWorkerRequestId;
            speechWorkerVersion = version;
            getSpeechWorker().postMessage({ id, audio: mono.buffer }, [mono.buffer]);
        } catch (error) {
            if (audioContext && audioContext.state !== "closed") {
                await audioContext.close();
            }
            if (version !== speechRequestVersion) return;
            speechTranscribing = false;
            speechStatus.textContent = `Could not process the recording: ${error.message}`;
            console.error("Could not process recorded speech:", error);
            processSpeechQueue();
            speechButton.disabled = speechTranscribing || speechQueue.length > 0;
        }
    }

    function startSpeechSegment(version) {
        if (!speechStream || version !== speechRequestVersion) return;
        speechChunks = [];
        speechRecorder = new MediaRecorder(speechStream);
        speechRecorder.addEventListener("dataavailable", event => {
            if (event.data.size > 0) speechChunks.push(event.data);
        });
        speechRecorder.addEventListener("error", event => {
            speechStatus.textContent = `Audio recording failed: ${event.error?.message || "unknown recorder error"}`;
            console.error("Audio recording failed:", event.error);
        });
        speechRecorder.addEventListener("stop", () => {
            const recording = new Blob(speechChunks, { type: speechChunks[0]?.type || "audio/webm" });
            speechChunks = [];
            speechRecorder = null;

            if (version === speechRequestVersion && recording.size > 0) {
                speechQueue.push({ blob: recording, version });
                processSpeechQueue();
            }

            if (speechActive && !speechStopRequested && version === speechRequestVersion) {
                startSpeechSegment(version);
                speechStatus.textContent = speechTranscribing
                    ? "Listening… transcribing recent speech on this device."
                    : "Listening… recognized speech will appear in the text box shortly.";
                return;
            }

            speechActive = false;
            speechStopRequested = false;
            window.clearInterval(speechSegmentTimer);
            speechSegmentTimer = null;
            speechStream?.getTracks().forEach(track => track.stop());
            speechStream = null;
            speechButton.disabled = speechTranscribing || speechQueue.length > 0;
            setSpeechActive(false);
        });
        speechRecorder.start();
    }

    function startVoiceTyping() {
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
            speechStatus.textContent = "Audio recording is not supported by this browser. Try a current Chrome or Edge browser.";
            return;
        }

        const version = ++speechRequestVersion;
        speechStarting = true;
        speechButton.disabled = true;
        speechButtonLabel.textContent = "Requesting microphone…";
        speechStatus.textContent = "Requesting microphone access…";
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            if (version !== speechRequestVersion) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }

            speechStarting = false;
            speechButton.disabled = false;
            speechStream = stream;
            try {
                speechActive = true;
                speechStopRequested = false;
                startSpeechSegment(version);
                speechSegmentTimer = window.setInterval(() => {
                    if (speechRecorder?.state === "recording") {
                        speechRecorder.stop();
                    }
                }, 4000);
                speechActive = true;
                setSpeechActive(true);
                speechStatus.textContent = "Listening… speech will appear in the text box as it is recognized.";
            } catch (error) {
                stream.getTracks().forEach(track => track.stop());
                speechStream = null;
                speechRecorder = null;
                speechActive = false;
                setSpeechActive(false);
                speechStatus.textContent = `Could not start recording: ${error.message}`;
                console.error("Could not start audio recording:", error);
            }
        }).catch(error => {
            if (version !== speechRequestVersion) return;
            speechStarting = false;
            speechButton.disabled = false;
            setSpeechActive(false);
            if (error.name === "NotAllowedError" || error.name === "SecurityError") {
                speechStatus.textContent = "Microphone access is blocked. Allow microphone access for this page in browser settings and check Windows microphone privacy settings.";
            } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
                speechStatus.textContent = "No microphone was found. Connect or enable a microphone, then try again.";
            } else {
                speechStatus.textContent = `Could not access the microphone: ${error.message}`;
            }
            console.error("Could not access microphone for voice typing:", error);
        });
    }

    for (const button of colorButtons) {
        button.addEventListener("click", () => selectColor(button.dataset.color));
    }

    customColor.addEventListener("input", () => {
        customPencil.style.setProperty("--pencil-color", customColor.value);
        selectColor(customColor.value);
    });
    brushSize.addEventListener("input", () => {
        brushSizeValue.value = `${brushSize.value} px`;
    });
    recognitionMode.addEventListener("change", () => {
        if (strokes.length) {
            scheduleRecognition();
        } else {
            recognitionStatus.textContent = `Recognition mode: ${recognitionMode.options[recognitionMode.selectedIndex].text}.`;
        }
    });
    recognizedText.addEventListener("input", () => {
        updateTranscriptDisplay();
        updateUndoButton();
        if (speechActive || speechStarting || speechTranscribing) {
            cancelVoiceInput("Voice recording stopped so your manual edit is kept.");
        }
    });
    speechButton.addEventListener("click", () => {
        if (speechActive) {
            if (speechRecorder && speechRecorder.state !== "inactive") {
                speechStopRequested = true;
                window.clearInterval(speechSegmentTimer);
                speechSegmentTimer = null;
                speechStatus.textContent = "Finishing the current speech segment…";
                speechRecorder.stop();
            }
        } else if (!speechStarting && !speechTranscribing) {
            startVoiceTyping();
        }
    });
    undoButton.addEventListener("click", () => {
        window.clearTimeout(recognitionTimer);
        recognitionVersion++;
        if (activeStroke) {
            activeStroke = null;
        }
        if (strokes.length > 0) {
            strokes.pop();
            redraw();
            if (strokes.length > 0) {
                scheduleRecognition();
            }
        } else {
            const lines = recognizedText.value.trimEnd().split("\n");
            lines.pop();
            recognizedText.value = lines.join("\n");
            updateTranscriptDisplay();
        }
        updateUndoButton();
    });
    clearButton.addEventListener("click", () => {
        if (speechActive || speechStarting || speechTranscribing) {
            cancelVoiceInput("Voice recording stopped because the text was cleared.");
        }
        strokes.length = 0;
        activeStroke = null;
        window.clearTimeout(recognitionTimer);
        recognitionVersion++;
        recognizedText.value = "";
        updateTranscriptDisplay();
        recognitionStatus.textContent = "Write one line at a time. Handwriting recognition runs on this device; first use downloads a roughly 160 MB model.";
        redraw();
        updateUndoButton();
    });

    resizeCanvas();
    if ("ResizeObserver" in window) {
        const canvasObserver = new ResizeObserver(resizeCanvas);
        canvasObserver.observe(canvas);
    }
    window.addEventListener("resize", resizeCanvas);
    canvas.addEventListener("pointerdown", startPosition);
    canvas.addEventListener("pointermove", draw);
    canvas.addEventListener("pointerup", finishedPosition);
    canvas.addEventListener("pointercancel", finishedPosition);
}) 