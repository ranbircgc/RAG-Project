# RAG Studio

Zero-cost local RAG. Upload files or folders, ask questions, and inspect cited passages. The included server safely connects the browser UI to local Ollama without browser cross-origin issues.

Supports drag-and-drop files/folders; PDF text extraction; local chunking and retrieval; grounded answers with citations; responsive chat; keyboard shortcut; fresh conversations; and private local processing.

## Run the app

Do not open `index.html` directly. From this project folder, run:

```bash
npm start
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000). Keep Ollama running in a separate terminal with `ollama serve`.

## Ollama generation

With Ollama installed, start the local service and download a model:

```bash
ollama serve
ollama pull llama3.2
```

Refresh the app, choose the detected model from the Ollama picker, and RAG answers will use that model. Models available through your signed-in Ollama account, including cloud model names, can be selected in the same picker.

The app defaults to `gpt-oss:120b-cloud` for high-quality cloud responses. Sign in once before using it:

```bash
ollama signin
ollama run gpt-oss:120b-cloud
```

Choose `qwen3:8b` in the picker any time you want answers to remain entirely local.
