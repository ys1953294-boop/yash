// Smart Notes — client-side notes app with content-based personalized recommendations
// Storage keys
const NOTES_KEY = 'smartnotes.notes';
const LIKES_KEY = 'smartnotes.likes';

// DOM
const titleEl = document.getElementById('title');
const subjectEl = document.getElementById('subject');
const tagsEl = document.getElementById('tags');
const importanceEl = document.getElementById('importance');
const contentEl = document.getElementById('content');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const notesList = document.getElementById('notesList');
const recoList = document.getElementById('recoList');
const searchEl = document.getElementById('search');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const addFileBtn = document.getElementById('addFileBtn');
const addFile = document.getElementById('addFile');

// Helpers
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const now = () => new Date().toISOString();

function loadNotes(){ try{ return JSON.parse(localStorage.getItem(NOTES_KEY) || 'null') || [] }catch(e){return []} }
function saveNotes(notes){ localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); }
function loadLikes(){ try{ return JSON.parse(localStorage.getItem(LIKES_KEY) || 'null') || [] }catch(e){return []} }
function saveLikes(likes){ localStorage.setItem(LIKES_KEY, JSON.stringify(likes)); }

// Basic tokenizer
function tokenize(text){ return (text||'').toLowerCase().match(/[a-z0-9]+/g) || [] }

// Build TF and IDF for documents
function buildTfIdf(docs){
  const tf = docs.map(doc=>{
    const terms = tokenize((doc.title||'') + ' ' + (doc.subject||'') + ' ' + (doc.tags||'').join(' ') + ' ' + (doc.content||''));
    const map = {};
    for(const t of terms) map[t] = (map[t]||0) + 1;
    const len = terms.length || 1;
    for(const k in map) map[k] = map[k]/len;
    return map;
  });
  const idf = {};
  const N = docs.length || 1;
  const allTerms = new Set();
  for(const m of tf) Object.keys(m).forEach(t=>allTerms.add(t));
  for(const t of allTerms){ let df=0; for(const m of tf) if(m[t]) df++; idf[t] = Math.log(1 + N/(1+df)); }
  const tfidf = tf.map(m=>{ const v={}; for(const k in m) v[k]=m[k]*idf[k]; return v });
  return {tfidf, idf};
}

function dot(a,b){ let s=0; for(const k in a) if(b[k]) s += a[k]*b[k]; return s }
function norm(a){ let s=0; for(const k in a) s += a[k]*a[k]; return Math.sqrt(s) }
function cosine(a,b){ const d=dot(a,b); const na=norm(a); const nb=norm(b); if(!na||!nb) return 0; return d/(na*nb); }

// --- Summarization utilities ---
function splitSentences(text){
  if(!text) return [];
  // naive sentence split keeping short lines
  return text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
}

function sentenceScoreMap(text){
  const sents = splitSentences(text);
  const words = tokenize(text);
  const freq = {};
  for(const w of words) freq[w] = (freq[w]||0) + 1;
  // normalize
  const maxf = Math.max(1, ...Object.values(freq));
  for(const k in freq) freq[k] = freq[k]/maxf;
  const map = {};
  for(const s of sents){
    const toks = tokenize(s);
    if(toks.length===0){ map[s]=0; continue }
    let sc=0; for(const t of toks) sc += (freq[t]||0);
    // favor shorter, punchy sentences a bit
    map[s] = sc / Math.sqrt(toks.length);
  }
  return map;
}

function summarizeNote(content, importance=3){
  const sents = splitSentences(content);
  if(sents.length===0) return {short:'',medium:'',long:''};
  const scores = sentenceScoreMap(content);
  const byScore = sents.slice().sort((a,b)=> (scores[b]||0) - (scores[a]||0));
  // choose counts proportional to desired durations
  const shortCount = Math.max(1, Math.min(byScore.length, 3));
  const medCount = Math.max(shortCount, Math.min(byScore.length, 6));
  const longCount = Math.max(medCount, Math.min(byScore.length, 12));
  const pick = (n)=> byScore.slice(0,n).sort((a,b)=> sents.indexOf(a)-sents.indexOf(b)).join(' ');
  return { short: pick(shortCount), medium: pick(medCount), long: pick(longCount) };
}

// --- File import / extraction (PDF, DOCX, TXT) ---
async function extractTextFromPDF(arrayBuffer){
  if(typeof pdfjsLib === 'undefined') throw new Error('pdfjsLib not available');
  try{
    // ensure worker set (CDN path used in index.html)
    if(!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    const loadingTask = pdfjsLib.getDocument({data: arrayBuffer});
    const pdf = await loadingTask.promise;
    let full = '';
    for(let p=1;p<=pdf.numPages;p++){
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items.map(i=>i.str).join(' ');
      full += (pageText + '\n');
    }
    return full.trim();
  }catch(e){ throw e }
}

async function extractTextFromDocx(arrayBuffer){
  if(typeof mammoth === 'undefined') throw new Error('mammoth not available');
  const result = await mammoth.extractRawText({arrayBuffer});
  return (result && result.value) ? result.value : '';
}

function filenameToTitle(name){ return name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g,' ').trim(); }

async function addFileNoteFromFile(file){
  if(!file) return;
  const name = file.name || 'file';
  const ext = (name.split('.').pop()||'').toLowerCase();
  try{
    if(ext === 'txt'){
      const reader = new FileReader();
      reader.onload = ()=>{ const text = reader.result || ''; const n = {id:uid(), title:filenameToTitle(name), subject:'', tags:[], content:text, importance:3, createdAt:now(), lastStudied:null}; const notes = loadNotes(); notes.push(n); saveNotes(notes); renderNotes(); alert('Imported note from ' + name); };
      reader.readAsText(file);
      return;
    }
    // for binary formats, read as arrayBuffer
    const reader = new FileReader();
    reader.onload = async ()=>{
      try{
        const ab = reader.result;
        let text = '';
        if(ext === 'pdf') text = await extractTextFromPDF(ab);
        else if(ext === 'docx') text = await extractTextFromDocx(ab);
        else { alert('Unsupported file type: ' + ext); return }
        const n = {id:uid(), title:filenameToTitle(name), subject:'', tags:[], content:text, importance:3, createdAt:now(), lastStudied:null};
        const notes = loadNotes(); notes.push(n); saveNotes(notes); renderNotes(); alert('Imported note from ' + name);
      }catch(err){ alert('Failed to extract file: ' + err.message) }
    };
    reader.readAsArrayBuffer(file);
  }catch(e){ alert('File import error: ' + e.message) }
}

// Helper to create summary UI inside a note element
function attachSummaryUI(container, note){
  // remove existing if any
  const existing = container.querySelector('.summary-panel'); if(existing) existing.remove();
  const panel = document.createElement('div'); panel.className='summary-panel';
  const btns = document.createElement('div'); btns.className='summary-btns';
  const b5 = document.createElement('button'); b5.textContent='5 min';
  const b10 = document.createElement('button'); b10.textContent='10 min';
  const b20 = document.createElement('button'); b20.textContent='20 min';
  btns.appendChild(b5); btns.appendChild(b10); btns.appendChild(b20);
  const out = document.createElement('div'); out.className='summary-out muted'; out.textContent='Select a duration to generate a summary.';
  panel.appendChild(btns); panel.appendChild(out);
  container.appendChild(panel);

  const sums = summarizeNote(note.content||'', note.importance);
  b5.onclick = ()=>{ out.innerHTML = `<strong>5 min summary</strong><p>${sums.short || 'No content'}</p>` };
  b10.onclick = ()=>{ out.innerHTML = `<strong>10 min summary</strong><p>${sums.medium || 'No content'}</p>` };
  b20.onclick = ()=>{ out.innerHTML = `<strong>20 min summary</strong><p>${sums.long || 'No content'}</p>` };
}

// Build user profile from liked notes (sum of vectors)
function buildUserProfile(noteVectors, likes){
  const profile = {};
  for(const id of likes){ const v = noteVectors[id]; if(!v) continue; for(const k in v) profile[k] = (profile[k]||0) + v[k]; }
  return profile;
}

// Helper: days between ISO strings
function daysBetween(iso){ if(!iso) return Infinity; return Math.max(0, (Date.now() - new Date(iso)).valueOf() / (1000*60*60*24)); }

// Compute recommendation scores using content + importance + recency + last-studied
function computeRecommendations(notes, likes){
  const docs = notes.slice();
  const {tfidf} = buildTfIdf(docs);
  const noteVectors = {};
  for(let i=0;i<docs.length;i++) noteVectors[docs[i].id] = tfidf[i];
  const profile = buildUserProfile(noteVectors, likes);
  const scores = [];
  for(const n of docs){
    if(likes.includes(n.id)) continue; // skip liked
    const v = noteVectors[n.id] || {};
    const contentScore = cosine(profile, v); // 0..1
    const importance = (n.importance||3); // default 3
    const importanceNorm = (importance - 1) / 4; // [0..1]
    const daysCreated = daysBetween(n.createdAt);
    const recencyBoost = 1 / (1 + daysCreated/30); // favors newer notes
    const daysSinceStudied = n.lastStudied ? daysBetween(n.lastStudied) : Infinity;
    const studiedBoost = n.lastStudied ? (1 / (1 + daysSinceStudied/14)) : 1; // never-studied gets full boost
    // Weighted sum
    const score = contentScore*0.6 + importanceNorm*0.2 + recencyBoost*0.15 + studiedBoost*0.05;
    scores.push({note:n,score,contentScore,importanceNorm,recencyBoost,studiedBoost});
  }
  scores.sort((a,b)=>b.score-a.score);
  return {scores, noteVectors, profile};
}

// UI render
function renderNotes(){
  const q = (searchEl.value||'').trim().toLowerCase();
  const notes = loadNotes().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const likes = loadLikes();
  notesList.innerHTML='';
  for(const n of notes){
    // basic search filter
    if(q){ const hay = ((n.title||'') + ' ' + (n.subject||'') + ' ' + (n.tags||[]).join(' ') + ' ' + (n.content||'')).toLowerCase(); if(!hay.includes(q)) continue }
    const el = document.createElement('div'); el.className='note';
    const h = document.createElement('h3'); h.textContent = n.title || '(untitled)';
    const p = document.createElement('p'); p.textContent = n.content.slice(0,200);
    const meta = document.createElement('div'); meta.className='meta';
    const subject = document.createElement('span'); subject.className='badge'; subject.textContent = n.subject || 'General';
    const importance = document.createElement('span'); importance.className='badge'; importance.textContent = 'imp: ' + (n.importance||3);
    const date = document.createElement('span'); date.textContent = new Date(n.createdAt).toLocaleString();
    const likeBtn = document.createElement('button'); likeBtn.className='like'; likeBtn.textContent = likes.includes(n.id) ? 'Liked ❤️' : 'Like'; likeBtn.onclick = ()=>{ toggleLike(n.id); }
    const studyBtn = document.createElement('button'); studyBtn.className='small-btn secondary'; studyBtn.textContent = 'Mark studied'; studyBtn.onclick = ()=>{ markStudied(n.id); }
    const summarizeBtn = document.createElement('button'); summarizeBtn.className='small-btn'; summarizeBtn.textContent = 'Summarize'; summarizeBtn.onclick = ()=>{ attachSummaryUI(el, n); }
    meta.appendChild(subject); meta.appendChild(importance); meta.appendChild(date); meta.appendChild(studyBtn); meta.appendChild(likeBtn);
    meta.appendChild(summarizeBtn);
    el.appendChild(h); el.appendChild(p); el.appendChild(meta);
    notesList.appendChild(el);
  }
  renderRecommendations();
}

function renderRecommendations(){
  const notes = loadNotes(); const likes = loadLikes();
  const {scores} = computeRecommendations(notes, likes);
  recoList.innerHTML='';
  if(scores.length===0){ recoList.innerHTML='<div class="muted">No recommendations yet — add and like notes to personalize.</div>'; return }
  for(const s of scores.slice(0,8)){
    const n = s.note;
    const el = document.createElement('div'); el.className='note';
    const h = document.createElement('h3'); h.textContent = n.title || '(untitled)';
    const p = document.createElement('p'); p.textContent = n.content.slice(0,120);
    const meta = document.createElement('div'); meta.className='meta';
    const score = document.createElement('span'); score.textContent = 'score: ' + s.score.toFixed(3);
    const why = document.createElement('span'); why.className='muted'; why.textContent = `content:${s.contentScore.toFixed(2)} imp:${s.importanceNorm.toFixed(2)} rec:${s.recencyBoost.toFixed(2)}`;
    const likeBtn = document.createElement('button'); likeBtn.className='like'; likeBtn.textContent = 'Like'; likeBtn.onclick = ()=>{ toggleLike(n.id); }
    const summarizeBtn = document.createElement('button'); summarizeBtn.className='small-btn'; summarizeBtn.textContent = 'Summarize'; summarizeBtn.onclick = ()=>{ attachSummaryUI(el, n); }
    meta.appendChild(score); meta.appendChild(why); meta.appendChild(likeBtn);
    meta.appendChild(summarizeBtn);
    el.appendChild(h); el.appendChild(p); el.appendChild(meta);
    recoList.appendChild(el);
  }
}

function toggleLike(id){ const likes = loadLikes(); const i = likes.indexOf(id); if(i>=0) likes.splice(i,1); else likes.push(id); saveLikes(likes); renderNotes(); }

function markStudied(id){ const notes = loadNotes(); const n = notes.find(x=>x.id===id); if(!n) return; n.lastStudied = now(); saveNotes(notes); renderNotes(); }

function clearForm(){ titleEl.value=''; subjectEl.value=''; tagsEl.value=''; contentEl.value=''; importanceEl.value='3'; }

function addNote(){
  const notes = loadNotes();
  const t = (titleEl.value||'').trim();
  const subject = (subjectEl.value||'').trim();
  const content = (contentEl.value||'').trim();
  const tags = (tagsEl.value||'').split(',').map(s=>s.trim()).filter(Boolean);
  const importance = parseInt(importanceEl.value||'3',10) || 3;
  if(!t && !content) return alert('Please add a title or some content');
  const n = {id:uid(), title:t, subject, tags, content, importance, createdAt:now(), lastStudied:null};
  notes.push(n); saveNotes(notes); clearForm(); renderNotes();
}

// Export & import
function exportNotes(){ const notes = loadNotes(); const blob = new Blob([JSON.stringify(notes, null, 2)], {type:'application/json'}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='smartnotes-export.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
function importNotesFile(file){ if(!file) return; const reader = new FileReader(); reader.onload = ()=>{
  try{ const data = JSON.parse(reader.result); if(!Array.isArray(data)) return alert('Invalid file'); if(!confirm('Import will append notes from the file. Continue?')) return; const notes = loadNotes(); for(const n of data){ if(n.id) notes.push(n); else { n.id = uid(); notes.push(n) } } saveNotes(notes); renderNotes(); }catch(e){ alert('Failed to import: ' + e.message) } }; reader.readAsText(file); }

// Seed examples
function seed(){ const notes = loadNotes(); if(notes.length>0) return; const sample = [
    {id:uid(), title:'Calculus — Integration tips', subject:'Math', tags:['calculus','integration'], importance:5, content:'Practice substitution and parts; review definite integrals and applications.', createdAt:now(), lastStudied:null},
    {id:uid(), title:'Biology — Cellular respiration', subject:'Biology', tags:['cell','metabolism'], importance:4, content:'Remember glycolysis, Krebs cycle, and electron transport chain steps.', createdAt:now(), lastStudied:null},
    {id:uid(), title:'Study plan — Exam week', subject:'General', tags:['planning','exam'], importance:5, content:'Break topics into 40-min blocks with active recall and spaced repetition.', createdAt:now(), lastStudied:null},
  ]; saveNotes(sample); }

// Events
saveBtn.addEventListener('click', addNote);
clearBtn.addEventListener('click', clearForm);
searchEl.addEventListener('input', ()=>renderNotes());
exportBtn.addEventListener('click', exportNotes);
importBtn.addEventListener('click', ()=>importFile.click());
importFile.addEventListener('change', (e)=>{ const f = e.target.files[0]; importNotesFile(f); importFile.value=''; });
if(addFileBtn && addFile){ addFileBtn.addEventListener('click', ()=>addFile.click()); addFile.addEventListener('change', (e)=>{ const f = e.target.files[0]; addFileNoteFromFile(f); addFile.value=''; }); }

// Init
seed(); renderNotes();
