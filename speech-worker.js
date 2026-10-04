import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

let transcriberPromise;

self.addEventListener("message", async ({ data }) => {
    const { id, audio } = data;
    try {
        if (!transcriberPromise) {
            transcriberPromise = pipeline(
                "automatic-speech-recognition",
                "Xenova/whisper-tiny.en",
                {
                    dtype: "q8",
                    progress_callback: progress => {
                        self.postMessage({
                            type: "progress",
                            id,
                            status: progress.status,
                            progress: progress.progress
                        });
                    }
                }
            );
        }

        const transcriber = await transcriberPromise;
        const result = await transcriber(new Float32Array(audio));
        self.postMessage({ type: "result", id, text: result.text.trim() });
    } catch (error) {
        transcriberPromise = null;
        self.postMessage({
            type: "error",
            id,
            message: error.message || String(error)
        });
    }
});
