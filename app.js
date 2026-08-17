if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const state = { docs: [], chunks: [], models: [], model: null };
const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

function tokens(text) { return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || []).filter(word => word.length > 2); }
function makeChunks(text, name) { const words = text.replace(/\s+/g, ' ').trim().split(' '), output = []; for (let start = 0; start < words.length; start += 90) { const passage = words.slice(start, start + 120).join(' '); if (passage.length > 20) output.push({ name, text: passage, tokens: tokens(passage) }); } return output; }

function renderSources() {
  $('#doc-count').textContent = state.docs.length;
  $('#source-summary').textContent = state.docs.length ? `${state.docs.length} source${state.docs.length === 1 ? '' : 's'} · ${state.chunks.length} passages` : 'No sources yet';
  $('#source-list').innerHTML = state.docs.length ? state.docs.map(doc => `<div class="source"><span class="file-badge">${doc.name.split('.').pop().slice(0, 4).toUpperCase()}</span><div><b>${esc(doc.name)}</b><small>${doc.words.toLocaleString()} words · ${doc.count} passages</small></div></div>`).join('') : '<p class="empty">Upload files or a folder to begin.</p>';
}
async function extractText(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (file.name.toLowerCase().endsWith('.pdf')) {
    if (!window.pdfjsLib) throw Error('The PDF reader could not load.');
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise, pages = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) { const page = await pdf.getPage(pageNo), content = await page.getTextContent(); pages.push(content.items.map(item => item.str).join(' ')); }
    return pages.join('\n');
  }
  if (extension === 'docx') {
    if (!window.mammoth) await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js'; script.onload = resolve; script.onerror = () => reject(Error('The DOCX reader could not load.')); document.head.append(script); });
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() }); return result.value;
  }
  const raw = await file.text();
  return file.name.toLowerCase().endsWith('.html') ? raw.replace(/<[^>]*>/g, ' ') : raw;
}
async function addFiles(files) {
  for (const file of files) {
    const name = file.webkitRelativePath || file.name;
    if (state.docs.some(doc => doc.name === name)) continue;
    try { const text = await extractText(file), passages = makeChunks(text, name); state.docs.push({ name, words: tokens(text).length, count: passages.length }); state.chunks.push(...passages); }
    catch { state.docs.push({ name, words: 0, count: 0 }); }
  }
  renderSources();
}
async function filesFromDrop(items) {
  const output = [];
  const visit = entry => new Promise(resolve => {
    if (entry.isFile) entry.file(file => { output.push(file); resolve(); });
    else if (entry.isDirectory) { const reader = entry.createReader(), read = () => reader.readEntries(async entries => { if (!entries.length) return resolve(); await Promise.all(entries.map(visit)); read(); }); read(); }
    else resolve();
  });
  await Promise.all([...items].map(item => item.webkitGetAsEntry ? visit(item.webkitGetAsEntry()) : Promise.resolve()));
  return output;
}
function retrieve(question) {
  const terms = tokens(question);
  const ranked = state.chunks.map(chunk => { const frequency = {}; chunk.tokens.forEach(term => frequency[term] = (frequency[term] || 0) + 1); return { ...chunk, score: terms.reduce((score, term) => score + (frequency[term] || 0), 0) / Math.sqrt(chunk.tokens.length || 1) + terms.filter(term => frequency[term]).length * .35 }; }).sort((a, b) => b.score - a.score);
  const matches = ranked.filter(chunk => chunk.score > 0);
  if (matches.length) return matches.slice(0, 5);
  const broadQuestion = /summar|overview|document|knowledge|what.{0,12}(contain|say|about)|key.{0,12}(insight|point|finding)/i.test(question);
  return ranked.slice(0, broadQuestion ? 12 : 5);
}
function retrievalAnswer(hits) {
  if (!state.chunks.length) return 'Your knowledge base is empty. Open <strong>Knowledge library</strong> and upload a file or folder.';
  if (!hits.length) return 'I couldn’t find a passage that answers that. Try terms used in your documents.';
  return `<strong>Grounded answer</strong><br>${esc(hits[0].text)}${hits[1] ? `<br><br>Related context: ${esc(hits[1].text.slice(0, 240))}…` : ''}`;
}
function addUser(question) { $('#hero').style.display = 'none'; $('#messages').insertAdjacentHTML('beforeend', `<div class="user-message"><span>${esc(question)}</span></div>`); }
function addAnswer(html, hits, label = 'LOCAL RETRIEVAL') { const template = $('#message-template').content.cloneNode(true); template.querySelector('.message-label span').textContent = label; template.querySelector('.answer').innerHTML = html; template.querySelector('.citation-row').innerHTML = hits.map((hit, index) => `<button class="citation" title="${esc(hit.text)}"><b>[${index + 1}]</b>${esc(hit.name)}</button>`).join(''); $('#messages').append(template); return $('#messages').lastElementChild; }
async function askOllama(question, hits) {
  const context = hits.map((hit, index) => `[${index + 1}] ${hit.name}\n${hit.text}`).join('\n\n');
  const prompt = context ? `You are a helpful assistant. Answer from the supplied source passages and cite passage numbers such as [1]. If the answer is not in the sources, say so rather than inventing it.\n\nSOURCES:\n${context}\n\nQUESTION: ${question}` : `You are a helpful, concise chatbot. Answer the user's question naturally.\n\nQUESTION: ${question}`;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 60000);
  const response = await fetch('/api/ollama/chat', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: state.model, messages: [{ role: 'user', content: prompt }], stream: false, think: false, options: { temperature: 0.2, num_predict: 500 } }) });
  clearTimeout(timeout);
  if (!response.ok) { const payload = await response.json().catch(() => ({})); throw Error(payload.error || `Ollama returned ${response.status}`); }
  const payload = await response.json(); return esc(payload.message.content).replace(/\n/g, '<br>');
}
async function send(question) {
  question = question.trim(); if (!question) return;
  $('#query').value = ''; addUser(question); const hits = retrieve(question);
  if (!state.model) { addAnswer(retrievalAnswer(hits), hits); return; }
  const message = addAnswer('<span style="color:#9aa3b5">Thinking with Ollama…</span>', hits, `OLLAMA · ${state.model}`);
  try { message.querySelector('.answer').innerHTML = await askOllama(question, hits); }
  catch (error) { message.querySelector('.answer').innerHTML = `<strong>Ollama couldn’t respond.</strong><br><span style="color:#9aa3b5">${esc(error.message)}</span><br><br>${retrievalAnswer(hits)}`; }
  $('#chat-area').scrollTop = $('#chat-area').scrollHeight;
}
function renderModels() {
  const list = $('#model-list');
  if (!state.models.length) { list.innerHTML = '<p class="empty">No models found. Run <code>ollama pull qwen3:8b</code>.</p>'; return; }
  list.innerHTML = state.models.map(model => `<button class="model-choice ${model.name === state.model ? 'selected' : ''}" data-model="${esc(model.name)}"><b>${esc(model.name)}</b><small>${model.name.includes('cloud') ? 'Ollama cloud' : 'Runs locally on this Mac'}</small></button>`).join('');
  list.querySelectorAll('button').forEach(button => button.onclick = () => { state.model = button.dataset.model; $('#model-button').innerHTML = `◎ ${esc(state.model)} <span>⌄</span>`; $('#privacy-note').textContent = state.model.includes('cloud') ? '☁ Retrieved passages are sent to your selected Ollama cloud model.' : '◉ Documents and model run locally on your Mac.'; renderModels(); $('#ollama-panel').classList.remove('open'); });
}
async function detectOllama() {
  try {
    const response = await fetch('/api/ollama/tags'), payload = await response.json();
    if (!response.ok) throw Error(payload.error);
    state.models = payload.models || [];
    const cloud = 'gpt-oss:120b-cloud'; if (!state.models.some(model => model.name === cloud)) state.models.unshift({ name: cloud });
    state.model = state.models.some(model => model.name === 'qwen3:8b') ? 'qwen3:8b' : cloud;
    $('#ollama-status').textContent = state.model === cloud ? 'Cloud default: gpt-oss:120b-cloud. Sign in to Ollama first.' : 'qwen3:8b is ready locally. A cloud model is also available below.';
    $('#model-button').innerHTML = `◎ ${esc(state.model)} <span>⌄</span>`;
    $('#privacy-note').textContent = state.model === cloud ? '☁ Retrieved passages are sent to your selected Ollama cloud model.' : '◉ Documents and model run locally on your Mac.';
  } catch { $('#ollama-status').textContent = 'Ollama is unavailable. Start it with “ollama serve”, then refresh.'; $('#model-button').innerHTML = '◎ Ollama offline <span>⌄</span>'; }
  renderModels();
}

$('#send').onclick = () => send($('#query').value);
$('#query').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(event.target.value); } };
document.querySelectorAll('.suggestion').forEach(button => button.onclick = () => send(button.dataset.query));
$('#focus-library').onclick = () => $('#library-panel').classList.add('open'); $('#close-panel').onclick = () => $('#library-panel').classList.remove('open');
$('#model-button').onclick = () => $('#ollama-panel').classList.add('open'); $('#close-ollama').onclick = () => $('#ollama-panel').classList.remove('open');
$('#file-input').onchange = event => addFiles(event.target.files); $('#folder-input').onchange = event => addFiles(event.target.files); $('#folder-link').onclick = event => { event.preventDefault(); event.stopPropagation(); $('#folder-input').click(); };
const dropzone = $('#dropzone'); ['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('drag'); })); ['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove('drag'); })); dropzone.addEventListener('drop', async event => { const files = await filesFromDrop(event.dataTransfer.items); await addFiles(files.length ? files : event.dataTransfer.files); });
$('#clear-sources').onclick = () => { state.docs = []; state.chunks = []; renderSources(); }; $('#new-chat').onclick = () => { $('#messages').innerHTML = ''; $('#hero').style.display = 'block'; $('#query').focus(); };
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#query').focus(); } });
renderSources(); detectOllama();
