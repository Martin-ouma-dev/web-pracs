import { env, pipeline, RawImage } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

let recognizerPromise;
let jobQueue = Promise.resolve();

async function recognize({ id, image }) {
    try {
        if (!recognizerPromise) {
            recognizerPromise = pipeline("image-to-text", "Xenova/trocr-small-handwritten", {
                dtype: "q8",
                progress_callback: progress => {
                    self.postMessage({
                        type: "progress",
                        id,
                        status: progress.status,
                        progress: progress.progress
                    });
                }
            });
        }

        const recognizer = await recognizerPromise;
        const input = await RawImage.fromBlob(image);
        const [result] = await recognizer(input, { max_new_tokens: 128 });
        self.postMessage({
            type: "result",
            id,
            text: result.generated_text.trim()
        });
    } catch (error) {
        recognizerPromise = null;
        self.postMessage({
            type: "error",
            id,
            message: error.message || String(error)
        });
    }
}

self.addEventListener("message", ({ data }) => {
    jobQueue = jobQueue.then(() => recognize(data));
});
