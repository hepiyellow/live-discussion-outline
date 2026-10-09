// The "New discussion" dialog on the Discussions page: start a session from a workspace, a folder, or a past session.

export function startDialogHtml() {
    return `<style>
.index-head{display:flex;align-items:center;gap:16px}
.index-head h1{flex:1}
#newd-open,#newd .actions button,#newd .pathrow button{font:inherit;font-size:13px;color:var(--fg);background:none;border:1px solid var(--line);border-radius:6px;padding:5px 12px;cursor:pointer}
#newd-open:hover,#newd .actions button:hover{background:color-mix(in srgb,var(--line) 40%,transparent)}
#newd .actions .primary{background:var(--accent);border-color:var(--accent);color:#fff}
#newd{width:min(720px,calc(100vw - 32px));max-height:min(720px,calc(100vh - 48px));padding:0;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--fg)}
#newd::backdrop{background:rgba(0,0,0,.45)}
#newd form{display:flex;flex-direction:column;max-height:inherit}
#newd h2{margin:0;padding:16px 20px 8px;font-size:18px}
#newd .dtabs{display:flex;gap:2px;padding:0 20px;border-bottom:1px solid var(--line)}
#newd .dtabs button{font:inherit;font-size:13px;color:var(--muted);background:none;border:1px solid transparent;border-bottom:0;border-radius:8px 8px 0 0;padding:6px 14px;margin-bottom:-1px;cursor:pointer}
#newd .dtabs button.on{color:var(--fg);font-weight:600;border-color:var(--line);background:var(--bg)}
#newd .pane{flex:1;min-height:220px;overflow:auto;padding:10px 20px}
#newd .pane[hidden]{display:none}
#newd .row{display:flex;gap:10px;align-items:baseline;padding:7px 8px;border-radius:6px;cursor:pointer}
#newd .row:hover{background:color-mix(in srgb,var(--line) 35%,transparent)}
#newd .row input{margin:0;flex:none}
#newd .row .main{min-width:0}
#newd .row .sub{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#newd .row .when{margin-left:auto;font-size:12px;color:var(--muted);white-space:nowrap}
#newd .pill{font-size:11px;border-radius:10px;padding:0 6px;color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent)}
#newd .pathrow{display:flex;gap:8px;margin-bottom:6px}
#newd input[type=text]{flex:1;font:inherit;font-size:13px;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:6px 8px}
#newd .note{font-size:13px;color:var(--muted);margin:4px 0 8px}
#newd .bottom{padding:12px 20px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:8px}
#newd .topic{display:flex;gap:8px;align-items:center;font-size:13px}
#newd .topic[hidden]{display:none}
#newd .err{color:#d1242f;font-size:13px;margin:0;min-height:1em}
#newd .err .inline{font:inherit;font-size:12px;color:var(--fg);background:none;border:1px solid var(--line);border-radius:6px;padding:2px 8px;margin-left:6px;cursor:pointer}
#newd .pill.open{color:#bf8700;background:color-mix(in srgb,#bf8700 16%,transparent);white-space:nowrap}
#newd .actions{display:flex;gap:8px;justify-content:flex-end}
</style>
<dialog id="newd"><form method="dialog">
<h2>New discussion</h2>
<div class="dtabs" role="tablist"><button type="button" role="tab" data-k="workspace" class="on">Workspace</button><button type="button" role="tab" data-k="folder">Folder</button><button type="button" role="tab" data-k="resume">Resume a session</button></div>
<div class="pane" data-k="workspace"><p class="note">Claude starts in the folder holding the workspace file, with the workspace's folders added. The outline files under the workspace's name.</p><div id="ws-list">Loading…</div></div>
<div class="pane" data-k="folder" hidden><div class="pathrow"><input type="text" id="dir-path" spellcheck="false" aria-label="Folder"><button type="button" id="dir-up" title="Parent folder">Up</button></div><p class="note">Claude starts in the folder shown above. Click a subfolder to open it.</p><div id="dir-list"></div></div>
<div class="pane" data-k="resume" hidden><p class="note">Continues that conversation in a new terminal, linked to an outline. A session marked "open in …" is still running in another app; two apps writing one session conflict, so Start offers to stop it there first.</p><div id="ses-list">Loading…</div></div>
<div class="bottom"><label class="topic" id="topic-row">Topic <input type="text" id="topic" placeholder="What the discussion is about (optional)"></label><p class="err" id="newd-err"></p>
<div class="actions"><button value="cancel">Cancel</button><button type="button" id="newd-start" class="primary">Start</button></div></div>
</form></dialog>
<script>
(()=>{const $=id=>document.getElementById(id),dialog=$('newd');let kind='workspace',options=null;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ago=t=>{const m=Math.round((Date.now()-t)/60000);return m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago'};
const setKind=k=>{kind=k;dialog.querySelectorAll('.dtabs [data-k]').forEach(b=>b.classList.toggle('on',b.dataset.k===k));
  dialog.querySelectorAll('.pane').forEach(p=>p.hidden=p.dataset.k!==k);$('topic-row').hidden=k==='resume';$('newd-err').textContent=''};
dialog.querySelector('.dtabs').onclick=e=>{const b=e.target.closest('[data-k]');if(b)setKind(b.dataset.k)};
const getJson=async url=>{const r=await fetch(url);const j=await r.json();if(!r.ok)throw new Error(j.error||r.statusText);return j};
const cd=async p=>{try{const j=await getJson('/api/dirs?path='+encodeURIComponent(p));$('dir-path').value=j.path;$('dir-up').dataset.to=j.parent;
    $('dir-list').innerHTML=j.dirs.map(d=>'<div class="row" data-to="'+esc(j.path+'/'+d.name)+'"><span class="main">'+esc(d.name)+'</span>'+(d.repo?' <span class="pill">git</span>':'')+'</div>').join('')||'<p class="note">No subfolders.</p>';
    $('newd-err').textContent=''}catch(e){$('newd-err').textContent=e.message}};
$('dir-list').onclick=e=>{const r=e.target.closest('[data-to]');if(r)cd(r.dataset.to)};
$('dir-up').onclick=()=>cd($('dir-up').dataset.to||'~');
$('dir-path').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();cd($('dir-path').value)}};
const load=async()=>{try{options=await getJson('/api/start-options')}catch(e){$('newd-err').textContent=e.message;return}
  $('ws-list').innerHTML=options.workspaces.map((w,i)=>'<label class="row"><input type="radio" name="ws" value="'+esc(w.file)+'"'+(i?'':' checked')+'><span class="main"><b>'+esc(w.name)+'</b><span class="sub">'+esc(w.folders.map(f=>f.name).join(' · '))+'</span></span></label>').join('')
    ||'<p class="note">No workspace files (.code-workspace) found. Set <code>workspaceDirs</code> in the config to the folders that hold them.</p>';
  $('ses-list').innerHTML=options.sessions.map((s,i)=>'<label class="row"><input type="radio" name="ses" value="'+s.id+'"'+(i?'':' checked')+'><span class="main">'+esc(s.title)+'<span class="sub">'+esc(s.cwd)+'</span></span>'+(s.openIn?'<span class="pill open" title="Running now (process '+s.openIn.pid+')">open in '+esc(s.openIn.app)+'</span>':'')+'<span class="when">'+ago(s.mtime)+'</span></label>').join('')
    ||'<p class="note">No Claude Code sessions found in ~/.claude/projects.</p>';
  if(!options.workspaces.length)setKind('folder')};
// Enter in the topic field starts; only Cancel closes the dialog.
dialog.querySelector('form').onsubmit=e=>{if(e.submitter&&e.submitter.value==='cancel')return;e.preventDefault();$('newd-start').click()};
$('newd-open').onclick=()=>{dialog.showModal();if(!options){load();cd('~')}};
$('newd-start').onclick=async()=>{const btn=$('newd-start'),topic=$('topic').value.trim();let req;
  if(kind==='workspace'){const r=dialog.querySelector('input[name=ws]:checked');if(!r)return;req={kind,file:r.value,topic}}
  else if(kind==='folder')req={kind,path:$('dir-path').value,topic};
  else{const r=dialog.querySelector('input[name=ses]:checked');if(!r)return;req={kind,id:r.value}}
  start(req)};
// Resuming a session open elsewhere: the server answers 409 with where it runs. One already in tmux is opened instead;
// one in another app can be stopped there and resumed here.
const start=async req=>{const btn=$('newd-start'),err=$('newd-err');btn.disabled=true;err.replaceChildren();
  try{const r=await fetch('/api/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)});const j=await r.json();
    if(r.ok)return location.href='/live?t='+encodeURIComponent(j.terminal);
    err.textContent=j.error||r.statusText;
    if(j.openIn){const b=document.createElement('button');b.type='button';b.className='inline';
      if(j.openIn.tmux){b.textContent='Open it';b.onclick=()=>location.href='/live?t='+encodeURIComponent(j.openIn.tmux)}
      else{b.textContent='Stop it in '+j.openIn.app+' and resume here';b.onclick=()=>start({...req,stopOther:true})}
      err.append(' ',b)}}
  catch(e){err.textContent=e.message}
  btn.disabled=false};
})();
</script>`
}
