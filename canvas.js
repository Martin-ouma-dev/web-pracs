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

    function resizeCanvas() {
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.round(canvas.clientWidth * pixelRatio);
        canvas.height = Math.round(canvas.clientHeight * pixelRatio);
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

    async function recognizeWriting(version) {
        try {
            if (!recognitionWorker && !recognitionWorkerPromise) {
                if (!window.Tesseract) {
                    throw new Error("The OCR library did not load.");
                }
                recognitionStatus.textContent = "Loading the on-device text recognizer…";
                recognitionWorkerPromise = (async () => {
                    const worker = await Tesseract.createWorker("eng", 1, {
                        logger: progress => {
                            if (version === recognitionVersion && progress.status) {
                                const percent = Number.isFinite(progress.progress)
                                    ? ` ${Math.min(100, Math.max(0, Math.round(progress.progress * 100)))}%`
                                    : "";
                                recognitionStatus.textContent = `Loading text recognizer: ${progress.status}${percent}`;
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

            if (version !== recognitionVersion || strokes.length === 0) return;
            const allowedCharacters = {
                text: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,?!'-",
                numbers: "0123456789.,-/%: "
            };
            recognitionStatus.textContent = "Reading your writing…";
            await recognitionWorker.setParameters({
                tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
                preserve_interword_spaces: "1",
                load_system_dawg: "0",
                load_freq_dawg: "0",
                tessedit_char_whitelist: allowedCharacters[recognitionMode.value] || ""
            });
            const result = await recognitionWorker.recognize(createRecognitionImage());
            if (version !== recognitionVersion) return;

            const text = result.data.text.trim();
            if (!text) {
                recognitionStatus.textContent = "No text detected. Try larger, clearer writing.";
                return;
            }

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
                recognitionStatus.textContent = `Uncertain reading${confidenceText}; kept the handwriting instead of guessing. Select Text or Numbers, add clearer writing, or redraw.`;
                return;
            }

            recognizedText.value = [recognizedText.value.trim(), text].filter(Boolean).join("\n");
            strokes.length = 0;
            redraw();
            updateTranscriptDisplay();
            updateUndoButton();
            if (recognitionMode.value === "numbers") {
                recognitionStatus.textContent = "Numbers transcribed visually; no sentence correction is applied. Write another line to continue.";
            } else {
                recognitionStatus.textContent = "Transcribed visually as written; no sentence correction is applied. Write another line to continue.";
            }
        } catch (error) {
            recognitionWorker = null;
            recognitionWorkerPromise = null;
            recognitionStatus.textContent = "Text recognition failed. Open this page through VS Code Live Server with internet access, then try again.";
            console.error("On-device text recognition failed:", error);
        }
    }

    function scheduleRecognition() {
        window.clearTimeout(recognitionTimer);
        const version = ++recognitionVersion;
        recognitionTimer = window.setTimeout(() => recognizeWriting(version), 2200);
        recognitionStatus.textContent = "Recognizing when you finish writing…";
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
        strokes.length = 0;
        activeStroke = null;
        window.clearTimeout(recognitionTimer);
        recognitionVersion++;
        recognizedText.value = "";
        updateTranscriptDisplay();
        recognitionStatus.textContent = "Write a line; it becomes text after a short pause. Recognition does not rewrite words using sentence context.";
        redraw();
        updateUndoButton();
    });

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    canvas.addEventListener("pointerdown", startPosition);
    canvas.addEventListener("pointermove", draw);
    canvas.addEventListener("pointerup", finishedPosition);
    canvas.addEventListener("pointercancel", finishedPosition);
}) 