import{useEffect as e,useRef as t,useState as n,createRoot as r,jsx as i,jsxs as a}from"../../../lib/esm/react-19.js";var o=`iob-dialog-close`;function s(e){return!!e.form}var c=[`header`,`staticText`,`divider`];function l(e,t){return e==null?``:typeof e==`object`?e[t]||e.en||Object.values(e).find(e=>!!e)||``:String(e)}function u(e){let t={};for(let[n,r]of Object.entries(e.items||{}))r&&!c.includes(r.type)&&(t[n]=r.type);return t}function d(e){return typeof e==`string`?e:typeof e==`number`||typeof e==`boolean`?e.toString():JSON.stringify(e)}function f(e,t){if(t!=null)switch(e){case`number`:case`slider`:{if(typeof t==`number`)return Number.isFinite(t)?t:void 0;let e=d(t).trim().replace(`,`,`.`);if(!e)return;let n=Number(e);return Number.isFinite(n)?n:void 0}case`checkbox`:return t===!0||t===`true`||t===1||t===`1`;default:return d(t)}}function p(e,t){let n={};for(let[r,i]of Object.entries(e)){let e=f(i,t[r]);e!==void 0&&(n[r]=e)}return n}var m=`"Roboto", "Helvetica", "Arial", sans-serif`,h=Object.freeze({type:`light`,primary:`#3399CC`,primaryContrast:`#FFFFFF`,secondary:`#164477`,secondaryContrast:`#FFFFFF`,background:`#FFFFFF`,paper:`#FFFFFF`,text:`rgba(0, 0, 0, 0.87)`,textSecondary:`rgba(0, 0, 0, 0.6)`,divider:`rgba(0, 0, 0, 0.12)`,error:`#D32F2F`,warning:`#ED6C02`,info:`#0288D1`,success:`#2E7D32`,fontFamily:m,fontSize:14,borderRadius:4}),g=Object.freeze({type:`dark`,primary:`#4DABF5`,primaryContrast:`rgba(0, 0, 0, 0.87)`,secondary:`#436A93`,secondaryContrast:`#FFFFFF`,background:`#121212`,paper:`#121212`,text:`#FFFFFF`,textSecondary:`rgba(255, 255, 255, 0.7)`,divider:`rgba(255, 255, 255, 0.12)`,error:`#F44336`,warning:`#FFA726`,info:`#29B6F6`,success:`#66BB6A`,fontFamily:m,fontSize:14,borderRadius:4}),_=[`primary`,`primaryContrast`,`secondary`,`secondaryContrast`,`background`,`paper`,`text`,`textSecondary`,`divider`,`error`,`warning`,`info`,`success`,`fontFamily`],v=[`fontSize`,`borderRadius`];function y(e){return{...e===`dark`?g:h}}function b(e){if(!e||typeof e!=`object`)return y(typeof e==`string`?e:`light`);let t=e,n=y(typeof t.type==`string`?t.type:`light`);for(let e of _){let r=t[e];typeof r==`string`&&r.trim()&&(n[e]=r.trim())}for(let e of v){let r=t[e],i=typeof r==`string`?parseFloat(r):r;typeof i==`number`&&Number.isFinite(i)&&i>=0&&(n[e]=i)}return n}function x(e,t){return e.type===t.type&&_.every(n=>e[n]===t[n])&&v.every(n=>e[n]===t[n])}function S(e){return`--iob-${e.replace(/[A-Z]/g,e=>`-${e.toLowerCase()}`)}`}function C(e){let t={};for(let n of _)t[S(n)]=e[n];for(let n of v)t[S(n)]=`${e[n]}px`;return t[`color-scheme`]=e.type,t}var w={ok:{en:`OK`,"zh-cn":`确定`},cancel:{en:`Cancel`,de:`Abbrechen`,ru:`Отмена`,pt:`Cancelar`,nl:`Annuleren`,fr:`Annuler`,it:`Annulla`,es:`Cancelar`,pl:`Anuluj`,uk:`Скасувати`,"zh-cn":`取消`},close:{en:`Close`,de:`Schließen`,ru:`Закрыть`,pt:`Fechar`,nl:`Sluiten`,fr:`Fermer`,it:`Chiudi`,es:`Cerrar`,pl:`Zamknij`,uk:`Закрити`,"zh-cn":`关闭`}},ee=`
dialog {
    box-sizing: border-box;
    width: 480px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    padding: 0;
    border: 0;
    border-radius: calc(var(--iob-border-radius) * 2);
    background: var(--iob-paper);
    color: var(--iob-text);
    font-family: var(--iob-font-family);
    font-size: var(--iob-font-size);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
/* as the dialogs of MUI: a dark paper gets lighter the higher it lies */
dialog.dark { background-image: linear-gradient(rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.16)); }
dialog::backdrop { background: rgba(0, 0, 0, 0.5); }
dialog:focus { outline: none; }
form { display: flex; flex-direction: column; height: 100%; max-height: inherit; margin: 0; }
header { display: flex; align-items: center; gap: 8px; padding: 12px 8px 12px 16px; font-size: 1.15em; font-weight: 500; }
header span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { flex: 1; min-height: 0; padding: 0 16px 16px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
footer { display: flex; justify-content: flex-end; gap: 8px; padding: 0 16px 16px; }
button { font: inherit; padding: 6px 16px; border-radius: var(--iob-border-radius); border: 1px solid var(--iob-primary); background: transparent; color: var(--iob-primary); cursor: pointer; }
button.primary { background: var(--iob-primary); color: var(--iob-primary-contrast); }
button.close { border: 0; padding: 2px 8px; font-size: 1.4em; line-height: 1; color: var(--iob-text-secondary); }
label { display: flex; flex-direction: column; gap: 4px; }
label.check { flex-direction: row; align-items: center; gap: 8px; }
input, select, textarea { font: inherit; accent-color: var(--iob-primary); }
.help { color: var(--iob-text-secondary); font-size: 0.85em; }
h3 { margin: 4px 0 0; font-size: 1em; }
p { margin: 0; }
hr { width: 100%; border: 0; border-top: 1px solid var(--iob-divider); margin: 0; }
[hidden] { display: none !important; }
`;function T(e){if(!e)return null;try{let t=Function(`data`,`return (${e});`);return e=>{try{return!!t(e)}catch{return!1}}}catch{return null}}function E(e){return typeof e==`string`?e:typeof e==`number`||typeof e==`boolean`?String(e):``}function D(e){let{input:t,setting:n}=e;if(t)return t instanceof HTMLInputElement&&t.type===`checkbox`?t.checked:t instanceof HTMLSelectElement?n.options?.[t.selectedIndex]?.value:t.value}function O(e,t,n,r,i){let a={name:t,setting:n,box:e.createElement(`div`),hidden:T(n.hidden),disabled:T(n.disabled)},o=l(n.label,i);switch(n.type){case`header`:return a.box=e.createElement(`h3`),a.box.textContent=l(n.text,i)||o,a;case`staticText`:return a.box=e.createElement(`p`),a.box.textContent=l(n.text,i)||o,a;case`divider`:return a.box=e.createElement(`hr`),a}let s=e.createElement(`label`);a.box=s;let c=e.createElement(`span`);if(c.textContent=o||t,n.type===`checkbox`){let t=e.createElement(`input`);t.type=`checkbox`,t.checked=r===!0||r===`true`,s.className=`check`,s.append(t,c),a.input=t}else if(n.type===`select`){let t=e.createElement(`select`);for(let r of n.options||[]){let n=e.createElement(`option`);n.textContent=l(r.label,i),t.append(n)}let o=(n.options||[]).findIndex(e=>String(e.value)===E(r));t.selectedIndex=o===-1?0:o,s.append(c,t),a.input=t}else if(n.type===`text`&&(n.minRows||1)>1){let t=e.createElement(`textarea`);t.rows=n.minRows||2,t.value=E(r),s.append(c,t),a.input=t}else{let t=e.createElement(`input`),i=E(r);switch(n.type){case`number`:case`slider`:t.type=n.type===`slider`?`range`:`number`,n.min!==void 0&&(t.min=String(n.min)),n.max!==void 0&&(t.max=String(n.max)),t.step=n.step===void 0?`any`:String(n.step);break;case`password`:t.type=`password`;break;case`color`:t.type=!i||/^#[0-9a-f]{6}$/i.test(i)?`color`:`text`;break;default:t.type=`text`}if(t.value=i,t.type===`range`){let n=e.createElement(`output`);n.textContent=t.value,t.addEventListener(`input`,()=>n.textContent=t.value),c.append(`: `,n)}s.append(c,t),a.input=t}if(n.help){let t=e.createElement(`span`);t.className=`help`,t.textContent=l(n.help,i),s.append(t)}return a}function k(e,t={}){let n=t.lang||`en`,r=document,i=e=>w[e][n]||w[e].en||e,a=r.createElement(`div`);a.setAttribute(`data-iob-dialog`,``);let c=a.attachShadow({mode:`open`}),d=r.createElement(`style`);d.textContent=ee;let f=r.createElement(`dialog`),m=b(t.theme);f.className=m.type===`dark`?`dark`:``;for(let[e,t]of Object.entries(C(m)))f.style.setProperty(e,t);e.width&&(f.style.width=`${e.width}px`),e.height&&(f.style.height=`${e.height}px`);let h=r.createElement(`form`),g=r.createElement(`header`),_=r.createElement(`span`);_.textContent=l(e.title,n);let v=r.createElement(`button`);v.type=`button`,v.className=`close`,v.title=i(`close`),v.setAttribute(`aria-label`,i(`close`)),v.textContent=`×`,g.append(_,v);let y=r.createElement(`div`);return y.className=`body`,h.append(g,y),f.append(h),c.append(d,f),new Promise(t=>{let d=!1,m=e=>{d||(d=!0,f.open&&f.close(),a.remove(),t(e))};if(v.addEventListener(`click`,()=>m(null)),f.addEventListener(`close`,()=>m(null)),h.addEventListener(`submit`,e=>e.preventDefault()),s(e)){let t={},a=[];for(let[t,i]of Object.entries(e.form.items||{})){let o=e.data?.[t]??i.default,s=O(r,t,i,o,n);a.push(s),y.append(s.box)}let o=()=>{for(let e of a)e.input&&(t[e.name]=D(e));return t},s=()=>{let e=o();for(let t of a)t.box.hidden=t.hidden?t.hidden(e):!1,t.input&&(t.input.disabled=t.disabled?t.disabled(e):!1)};h.addEventListener(`input`,s),h.addEventListener(`change`,s),s();let c=a.find(e=>e.input&&!e.box.hidden&&!e.input.disabled);c?.input&&(c.input.autofocus=!0);let d=r.createElement(`footer`),f=r.createElement(`button`);f.type=`button`,f.textContent=l(e.cancel,n)||i(`cancel`),f.addEventListener(`click`,()=>m(null));let g=r.createElement(`button`);g.type=`submit`,g.className=`primary`,g.textContent=l(e.ok,n)||i(`ok`),d.append(f,g),h.append(d),h.addEventListener(`submit`,()=>m(p(u(e.form),o())))}else y.append(e.element),f.addEventListener(o,e=>m(e.detail??null));r.body.append(a),f.showModal(),c.activeElement&&c.activeElement!==v||(f.tabIndex=-1,f.focus())})}function A(e){return[...new Set(e.filter(e=>typeof e==`string`&&!!e))]}var j=[`socket`,`dialogs`,`theme`,`editMode`,`settings`,`value`],M=class extends HTMLElement{states={};objects={};#e=null;#t={};#n=b(`light`);#r=!1;#i=null;#a=void 0;#o=null;#s=!1;#c=(e,t)=>{this.#o?.states.includes(e)&&(this.states[e]=t||null,this.#_())};#l=(e,t)=>{this.#o?.objects.includes(e)&&(this.objects[e]=t||null,this.#d())};get socket(){return this.#e}set socket(e){this.#e=e||null,this.#d()}get settings(){return this.#t}set settings(e){this.#t=e||{},this.#d()}get theme(){return this.#n}set theme(e){let t=b(e);x(t,this.#n)||(this.#n=t,this.#u(),this.#_())}get editMode(){return this.#r}set editMode(e){let t=!!e;t!==this.#r&&(this.#r=t,this.#_())}get dialogs(){return this.#i}set dialogs(e){this.#i=e||null}get value(){return this.#a}set value(e){e!==this.#a&&(this.#a=e,this.#_())}connectedCallback(){for(let e of j)if(Object.prototype.hasOwnProperty.call(this,e)){let t=this[e];delete this[e],this[e]=t}this.#u(),this.#d()}disconnectedCallback(){this.#g()}getStateIds(e){return[]}getObjectIds(e){return[]}get systemLang(){return this.#e?.systemLang||`en`}text(e){return l(e,this.systemLang)}setState(e,t){return this.#e&&!this.#r?this.#e.setState(e,t):Promise.resolve()}changeValue(e){return this.#r||this.emit(`iob-change`,e)?!1:(this.value=e,!0)}emit(e,t){return this.dispatchEvent(new CustomEvent(e,{detail:t,bubbles:!0,composed:!0,cancelable:!0}))}async openDialog(e){if(this.#r)return null;let t=this.#i?await this.#i.open(e):await k(e,{lang:this.systemLang,theme:this.#n});return s(e)?t&&typeof t==`object`?p(u(e.form),t):null:t??null}#u(){for(let[e,t]of Object.entries(C(this.#n)))this.style.setProperty(e,t)}#d(){if(!this.isConnected)return;let e=this.#e,t=e?A(this.getStateIds(this.#t)):[],n=e?A(this.getObjectIds(this.#t)):[];this.#o&&this.#o.socket!==e&&this.#g();let r=this.#o?.states||[],i=this.#o?.objects||[],a=r.filter(e=>!t.includes(e)),o=i.filter(e=>!n.includes(e)),s=t.filter(e=>!r.includes(e)),c=n.filter(e=>!i.includes(e));e&&a.length&&e.unsubscribeState(a,this.#c),e&&o.length&&this.#h(e,o);for(let e of a)delete this.states[e];for(let e of[...a,...o])!t.includes(e)&&!n.includes(e)&&delete this.objects[e];this.#o=e&&(t.length||n.length)?{socket:e,states:t,objects:n}:null,e&&s.length&&this.#p(e,s),e&&c.length&&this.#m(e,c),this.#_()}#f(e,t,n){return this.#o?.socket===e&&this.#o[t].includes(n)}#p(e,t){e.subscribeState(t,this.#c).catch(e=>console.warn(`<${this.localName}>: cannot subscribe ${t.join(`, `)}: ${e}`));for(let n of t)e.getState(n).then(t=>{this.#f(e,`states`,n)&&this.states[n]===void 0&&(this.states[n]=t||null,this.#_())}).catch(()=>{}),e.getObject(n).then(t=>{this.#f(e,`states`,n)&&!this.#f(e,`objects`,n)&&(this.objects[n]=t||null,this.#_())}).catch(()=>{})}#m(e,t){e.subscribeObject(t,this.#l).catch(e=>console.warn(`<${this.localName}>: cannot subscribe the objects ${t.join(`, `)}: ${e}`));for(let n of t)e.getObject(n).then(t=>{this.#f(e,`objects`,n)&&(this.objects[n]=t||null,this.#d())}).catch(()=>{})}#h(e,t){e.unsubscribeObject(t,this.#l).catch(()=>{})}#g(){if(this.#o){let{socket:e,states:t,objects:n}=this.#o;t.length&&e.unsubscribeState(t,this.#c),n.length&&this.#h(e,n),this.#o=null}this.states={},this.objects={}}#_(){this.#s||(this.#s=!0,queueMicrotask(()=>{this.#s=!1,this.isConnected&&this.render()}))}};function N(e,t){let n=typeof e==`string`?e:e.tag;customElements.get(n)||customElements.define(n,t)}var P=[`stats`,`events`,`info`,`remote`,`notification`,`zones`,`sub_labels`];function F(e){if(!e)return null;let t=e.split(`.`);if(t[0]!==`frigate`||t.length<3)return null;let n=t[1],r=t[2];return!r||P.includes(r)?null:{instanceId:n,name:r,instance:`frigate.${n}`}}function te(){return typeof window<`u`&&/(^|\.)iobroker\.(pro|net)$/i.test(window.location.hostname)}function ne(e,t=`image/jpeg`){return`data:${t};base64,${e}`}function re(e,t,n,r,i){let a=(e||``).replace(/\/+$/,``),o=(t||`${n.instance}/`).replace(/^\/+/,``).replace(/\/*$/,`/`),s=new URLSearchParams;for(let[e,t]of Object.entries(i||{}))t!==void 0&&t!==``&&t!==0&&s.append(e,String(t));let c=s.toString();return`${a}/${o}${n.name}/${r}${c?`?${c}`:``}`}var I=class{options;timer=null;requesting=!1;running=!1;generation=0;constructor(e){this.options=e}start(){this.stop(),this.running=!0,this.poll()}stop(){this.running=!1,this.generation++,this.timer&&=(clearTimeout(this.timer),null)}reschedule(){this.running&&this.timer&&(clearTimeout(this.timer),this.timer=null,this.poll())}async poll(){let e=this.options.getCamera();if(!this.running||this.requesting||!e)return;this.requesting=!0;let t=this.generation,n=Date.now();try{let n=await this.options.getSocket().sendTo(e.instance,`snapshot`,{camera:e.name,...this.options.getParams()});if(t!==this.generation)return;n?.error?this.options.onError(n.error):n?.data?this.options.onFrame(n.data):this.options.onError(`No data`)}catch(e){t===this.generation&&this.options.onError(e.toString())}finally{this.requesting=!1,this.scheduleNext(Date.now()-n)}}scheduleNext(e){this.running&&(this.timer=setTimeout(()=>{this.timer=null,this.poll()},Math.max(0,this.options.getInterval()-e)))}},L=`iob-frigate-live`;function R(e,t){if(t)return 720;let n=parseInt(e.height||``,10);return n>0?n:480}function z(e){return Math.min(30,Math.max(1,Math.round(Number(e.fps))||5))}var B=3e3,V=1e4,H={en:{frigate_no_camera:`No camera selected`,frigate_loading:`Loading…`,frigate_stream_needs_web:`Stream not reachable. Enter the web instance in the settings.`,frigate_web_disabled:`Camera proxy is switched off. Pick a web instance under "Camera proxy" in the frigate instance settings.`,frigate_web_error:`The address of the web instance could not be worked out. See the adapter log for details.`,frigate_web_noAddress:`The host of the web instance has no reachable address. Please enter the web instance manually.`,frigate_web_noInstance:`No running web instance. The live view needs the web adapter - otherwise use the snapshot widget.`},de:{frigate_no_camera:`Keine Kamera ausgewählt`,frigate_loading:`Wird geladen…`,frigate_stream_needs_web:`Stream nicht erreichbar. Web-Instanz in den Einstellungen eintragen.`,frigate_web_disabled:`Kamera-Proxy ist ausgeschaltet. In den Einstellungen der frigate-Instanz unter „Kamera-Proxy“ eine web-Instanz wählen.`,frigate_web_error:`Adresse der web-Instanz konnte nicht ermittelt werden. Details im Adapter-Log.`,frigate_web_noAddress:`Host der web-Instanz hat keine erreichbare Adresse. Web-Instanz bitte manuell eintragen.`,frigate_web_noInstance:`Keine laufende web-Instanz. Live-Bild braucht den web-Adapter — sonst das Standbild-Widget nutzen.`},ru:{frigate_no_camera:`Камера не выбрана`,frigate_loading:`Загрузка…`,frigate_stream_needs_web:`Поток недоступен. Укажите экземпляр web в настройках.`,frigate_web_disabled:`Прокси камер выключен. Выберите экземпляр web в разделе «Прокси камер» в настройках экземпляра frigate.`,frigate_web_error:`Не удалось определить адрес экземпляра web. Подробности в логе адаптера.`,frigate_web_noAddress:`У хоста экземпляра web нет доступного адреса. Укажите экземпляр web вручную.`,frigate_web_noInstance:`Нет запущенного экземпляра web. Живое изображение требует адаптер web - иначе используйте виджет снимка.`},pt:{frigate_no_camera:`Nenhuma câmera selecionada`,frigate_loading:`A carregar…`,frigate_stream_needs_web:`Fluxo inacessível. Indique a instância web nas definições.`,frigate_web_disabled:`O proxy de câmeras está desligado. Escolha uma instância web em «Proxy de câmeras» nas definições da instância frigate.`,frigate_web_error:`Não foi possível deduzir o endereço da instância web. Detalhes no registo do adaptador.`,frigate_web_noAddress:`O host da instância web não tem um endereço alcançável. Introduza a instância web manualmente.`,frigate_web_noInstance:`Nenhuma instância web em execução. A vista ao vivo precisa do adaptador web - caso contrário, use o widget de instantâneo.`},nl:{frigate_no_camera:`Geen camera geselecteerd`,frigate_loading:`Laden…`,frigate_stream_needs_web:`Stream niet bereikbaar. Vul de web-instantie in bij de instellingen.`,frigate_web_disabled:`Cameraproxy staat uit. Kies een web-instantie onder „Cameraproxy” in de instellingen van de frigate-instantie.`,frigate_web_error:`Het adres van de web-instantie kon niet worden bepaald. Details in het adapterlogboek.`,frigate_web_noAddress:`De host van de web-instantie heeft geen bereikbaar adres. Voer de web-instantie handmatig in.`,frigate_web_noInstance:`Geen draaiende web-instantie. Live beeld heeft de web-adapter nodig - gebruik anders het momentopname-widget.`},fr:{frigate_no_camera:`Aucune caméra sélectionnée`,frigate_loading:`Chargement…`,frigate_stream_needs_web:`Flux inaccessible. Indiquez l'instance web dans les paramètres.`,frigate_web_disabled:`Le proxy de caméras est désactivé. Choisissez une instance web sous « Proxy de caméras » dans les réglages de l'instance frigate.`,frigate_web_error:`L'adresse de l'instance web n'a pas pu être déterminée. Détails dans le journal de l'adaptateur.`,frigate_web_noAddress:`L'hôte de l'instance web n'a pas d'adresse joignable. Veuillez saisir l'instance web manuellement.`,frigate_web_noInstance:`Aucune instance web en cours d'exécution. La vue en direct nécessite l'adaptateur web - sinon, utilisez le widget instantané.`},it:{frigate_no_camera:`Nessuna telecamera selezionata`,frigate_loading:`Caricamento…`,frigate_stream_needs_web:`Flusso non raggiungibile. Inserisci l'istanza web nelle impostazioni.`,frigate_web_disabled:`Il proxy telecamere è disattivato. Scegli un'istanza web sotto «Proxy telecamere» nelle impostazioni dell'istanza frigate.`,frigate_web_error:`Impossibile ricavare l'indirizzo dell'istanza web. Dettagli nel log dell'adattatore.`,frigate_web_noAddress:`L'host dell'istanza web non ha un indirizzo raggiungibile. Inserisci l'istanza web manualmente.`,frigate_web_noInstance:`Nessuna istanza web in esecuzione. La vista dal vivo richiede l'adattatore web - altrimenti usa il widget istantanea.`},es:{frigate_no_camera:`Ninguna cámara seleccionada`,frigate_loading:`Cargando…`,frigate_stream_needs_web:`Flujo inaccesible. Indique la instancia web en los ajustes.`,frigate_web_disabled:`El proxy de cámaras está desactivado. Elija una instancia web en «Proxy de cámaras» en los ajustes de la instancia frigate.`,frigate_web_error:`No se pudo deducir la dirección de la instancia web. Consulte el registro del adaptador.`,frigate_web_noAddress:`El host de la instancia web no tiene una dirección alcanzable. Introduzca la instancia web manualmente.`,frigate_web_noInstance:`No hay ninguna instancia web en ejecución. La vista en vivo necesita el adaptador web; si no, use el widget de instantánea.`},pl:{frigate_no_camera:`Nie wybrano kamery`,frigate_loading:`Ładowanie…`,frigate_stream_needs_web:`Strumień niedostępny. Podaj instancję web w ustawieniach.`,frigate_web_disabled:`Proxy kamer jest wyłączone. Wybierz instancję web w sekcji „Proxy kamer” w ustawieniach instancji frigate.`,frigate_web_error:`Nie udało się ustalić adresu instancji web. Szczegóły w logu adaptera.`,frigate_web_noAddress:`Host instancji web nie ma osiągalnego adresu. Wprowadź instancję web ręcznie.`,frigate_web_noInstance:`Brak działającej instancji web. Podgląd na żywo wymaga adaptera web - w przeciwnym razie użyj widżetu zdjęcia.`},uk:{frigate_no_camera:`Камеру не вибрано`,frigate_loading:`Завантаження…`,frigate_stream_needs_web:`Потік недоступний. Вкажіть екземпляр web у налаштуваннях.`,frigate_web_disabled:`Проксі камер вимкнено. Оберіть екземпляр web у розділі «Проксі камер» у налаштуваннях екземпляра frigate.`,frigate_web_error:`Не вдалося визначити адресу екземпляра web. Подробиці в лозі адаптера.`,frigate_web_noAddress:`Хост екземпляра web не має доступної адреси. Вкажіть екземпляр web вручну.`,frigate_web_noInstance:`Немає запущеного екземпляра web. Живе зображення потребує адаптер web - інакше скористайтеся віджетом знімка.`},"zh-cn":{frigate_no_camera:`未选择摄像机`,frigate_loading:`加载中…`,frigate_stream_needs_web:`无法访问视频流。请在设置中填写 web 实例。`,frigate_web_disabled:`摄像机代理已关闭。请在 frigate 实例设置的“摄像机代理”中选择一个 web 实例。`,frigate_web_error:`无法推算 web 实例的地址。详情见适配器日志。`,frigate_web_noAddress:`web 实例所在主机没有可达地址。请手动填写 web 实例。`,frigate_web_noInstance:`没有正在运行的 web 实例。实时画面需要 web 适配器，否则请使用快照小部件。`}},U={notCamera:`Not a camera of Frigate`,enlarge:`Enlarge`},W={en:U,de:{notCamera:`Keine Kamera von Frigate`,enlarge:`Vergrößern`},ru:{notCamera:`Это не камера Frigate`,enlarge:`Увеличить`},pt:{notCamera:`Não é uma câmera do Frigate`,enlarge:`Ampliar`},nl:{notCamera:`Geen camera van Frigate`,enlarge:`Vergroten`},fr:{notCamera:`Ce n'est pas une caméra de Frigate`,enlarge:`Agrandir`},it:{notCamera:`Non è una telecamera di Frigate`,enlarge:`Ingrandisci`},es:{notCamera:`No es una cámara de Frigate`,enlarge:`Ampliar`},pl:{notCamera:`To nie jest kamera Frigate`,enlarge:`Powiększ`},uk:{notCamera:`Це не камера Frigate`,enlarge:`Збільшити`},"zh-cn":{notCamera:`不是 Frigate 的摄像机`,enlarge:`放大`}};function G(e,t){return t in U?W[e]?.[t]||U[t]:H[e]?.[t]||H.en?.[t]||t}var K=`
.picture {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    overflow: hidden;
}
.picture img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.stream {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
}
.overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
}
.spinner {
    box-sizing: border-box;
    width: clamp(16px, 14cqmin, 40px);
    height: clamp(16px, 14cqmin, 40px);
    border-radius: 50%;
    border: clamp(2px, 1.2cqmin, 4px) solid color-mix(in srgb, var(--iob-primary) 25%, transparent);
    border-top-color: var(--iob-primary);
    animation: spin 0.9s linear infinite;
}
@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}
.hint {
    box-sizing: border-box;
    max-width: 100%;
    max-height: 100%;
    padding: 0.5em;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4em;
    text-align: center;
    overflow: hidden;
    overflow-wrap: anywhere;
    color: var(--iob-text-secondary);
    font-size: clamp(10px, 5cqmin, 15px);
    line-height: 1.35;
}
.hint.error {
    color: var(--iob-error);
}
.hint svg {
    flex: none;
    width: clamp(18px, 13cqmin, 40px);
    height: clamp(18px, 13cqmin, 40px);
    fill: currentColor;
    opacity: 0.6;
}
`,q=`
${K}
:host {
    display: block;
    width: 100%;
    height: 100%;
}
.mount {
    width: 100%;
    height: 100%;
    /* the size of the box does not depend on what is in it - no loop between measuring and laying out */
    container-type: size;
}
.tile {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: clamp(2px, 1.5cqmin, 6px);
    overflow: hidden;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
}
.tile.clickable {
    cursor: pointer;
}
.tile.edit {
    pointer-events: none;
}
.tile:focus-visible {
    outline: 2px solid var(--iob-primary);
    outline-offset: -2px;
    border-radius: var(--iob-border-radius);
}
.tile > .picture {
    flex: 1;
    min-height: 0;
    border-radius: var(--iob-border-radius);
}
.tile > .picture.empty {
    background: color-mix(in srgb, currentColor 6%, transparent);
}
.label {
    flex: none;
    padding: 0 0.3em;
    font-size: clamp(10px, 5.5cqmin, 16px);
    font-weight: 700;
    line-height: 1.4;
    color: var(--iob-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
`,J=`
${K}
:host {
    display: block;
}
.full {
    width: 100%;
    display: flex;
    justify-content: center;
}
.full > .picture {
    width: 100%;
}
.full .stream {
    height: auto;
}
.full img {
    height: auto;
    /* the whole frame on the screen: what the dialog takes around the picture is about 140 px */
    max-height: calc(100vh - 140px);
}
/* a picture that is not there yet has no height: keep about the place of a 16:9 picture meanwhile */
.full > .picture.empty,
.full .stream.loading {
    min-height: min(50vh, 56vw);
}
.full .spinner {
    width: 40px;
    height: 40px;
    border-width: 4px;
}
.full .hint {
    font-size: 15px;
}
.full .hint svg {
    width: 40px;
    height: 40px;
}
`,Y=`M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z`;function ie(){return/* @__PURE__ */ i(`svg`,{viewBox:`0 0 24 24`,"aria-hidden":`true`,children:/* @__PURE__ */ i(`path`,{d:Y})})}function X(){return/* @__PURE__ */ i(`div`,{className:`overlay`,children:/* @__PURE__ */ i(`div`,{className:`spinner`})})}function ae({src:r,alt:o,onFail:s}){let c=t(null),l=t(s),[u,d]=n(!1);return e(()=>{l.current=s},[s]),e(()=>{if(u)return;let e=setTimeout(()=>l.current(`no frame within ${V} ms`),V);return()=>clearTimeout(e)},[u]),e(()=>{let e=c.current;return()=>e?.removeAttribute(`src`)},[]),/* @__PURE__ */ a(`div`,{className:`stream${u?``:` loading`}`,children:[/* @__PURE__ */ i(`img`,{ref:c,src:r,alt:o,onLoad:()=>d(!0),onError:()=>s(`cannot load it`)}),u?null:/* @__PURE__ */ i(X,{})]})}function Z({view:e,alt:t}){let n=null;switch(e.kind){case`hint`:n=/* @__PURE__ */ a(`div`,{className:`hint${e.error?` error`:``}`,children:[/* @__PURE__ */ i(ie,{}),/* @__PURE__ */ i(`span`,{children:e.text})]});break;case`loading`:n=/* @__PURE__ */ i(X,{});break;case`frame`:n=/* @__PURE__ */ i(`img`,{src:e.src,alt:t});break;case`stream`:n=/* @__PURE__ */ i(ae,{src:e.src,alt:t,onFail:e.onFail},e.id)}let r=e.kind!==`frame`&&e.kind!==`stream`;return/* @__PURE__ */ i(`div`,{className:`picture${r?` empty`:``}`,children:n})}function oe({view:e,label:t,alt:n,editMode:r,onOpen:o,word:s}){let c=!r&&!!o,l=[`tile`];return c&&l.push(`clickable`),r&&l.push(`edit`),/* @__PURE__ */ a(`div`,{className:l.join(` `),role:c?`button`:void 0,tabIndex:c?0:void 0,title:c?s(`enlarge`):void 0,onClick:c?o:void 0,onKeyDown:c?e=>{(e.key===`Enter`||e.key===` `)&&(e.preventDefault(),o())}:void 0,children:[/* @__PURE__ */ i(Z,{view:e,alt:n}),t?/* @__PURE__ */ i(`div`,{className:`label`,children:t}):null]})}function Q(e){return`${e.instance}.${e.name}`}var se=class extends M{#e;camera=null;#t=null;#n=null;constructor(){super();let e=this.attachShadow({mode:`open`}),t=document.createElement(`style`);t.textContent=q;let n=document.createElement(`div`);n.className=`mount`,e.append(t,n),this.#e=r(n)}get isRunning(){return!!this.#t}get dialogOpen(){return!!this.#n}word=e=>G(this.systemLang,e);syncDelivery(){}onDialogToggled(){}getRestartKey(e){return``}getObjectIds(e){let t=F(e.camera);return t?[Q(t)]:[]}disconnectedCallback(){super.disconnectedCallback(),this.#a(),this.#e.render(null),this.#n?.element.dispatchEvent(new CustomEvent(o,{detail:null,bubbles:!0,composed:!0}))}#r(){let e=this.settings;if(!e.camera)return this.word(`frigate_no_camera`);let t=F(e.camera),n=(t?this.objects[Q(t)]:null)?.common?.name;return!t||typeof n==`string`&&n.startsWith(`Zone `)?this.word(`notCamera`):t}#i(e){let t=this.socket,n=e?`${Q(e)}\n${this.getRestartKey(this.settings)}`:``;this.#t&&(this.#t.key!==n||this.#t.socket!==t)&&this.#a(),this.camera=e,!this.#t&&e&&t&&this.isConnected&&(this.#t={key:n,socket:t},this.startCamera()),this.syncDelivery()}#a(){this.#t&&(this.#t=null,this.stopCamera()),this.syncDelivery()}#o(){return this.settings.name||this.camera?.name||``}#s=()=>{let e=this.camera;this.editMode||this.#n||!e||this.emit(`frigate-camera-click`,{instance:e.instance,camera:e.name})&&this.#c()};async#c(){let e=document.createElement(`div`),t=e.attachShadow({mode:`open`}),n=document.createElement(`style`);n.textContent=J;let i=document.createElement(`div`);i.className=`full`,t.append(n,i);let a=r(i);this.#n={element:e,root:a},this.onDialogToggled(),this.render();try{await this.openDialog({title:this.#o(),element:e,width:1200})}finally{this.#n=null,a.unmount(),this.onDialogToggled(),this.isConnected&&this.render()}}#l(){let e=this.#n;if(e){for(let[t,n]of Object.entries(C(this.theme)))e.element.style.setProperty(t,n);e.root.render(/* @__PURE__ */ i(Z,{view:this.getView(!0),alt:this.camera?.name||``}))}}render(){let e=this.#r();this.#i(typeof e==`string`?null:e);let t=typeof e==`string`?{kind:`hint`,text:e}:this.getView(!1);this.#e.render(/* @__PURE__ */ i(oe,{view:t,label:this.settings.showName===!1?``:this.#o(),alt:this.camera?.name||``,editMode:this.editMode,onOpen:this.camera?this.#s:null,word:this.word})),this.#l()}},$={resolved:!1,url:``,route:``,reason:``},ce={disabled:`frigate_web_disabled`,noInstance:`frigate_web_noInstance`,noAddress:`frigate_web_noAddress`,error:`frigate_web_error`};N(L,class extends se{#e=te();#t=$;#n=0;#r=!1;#i=0;#a=``;#o=``;#s=!1;#c=new I({getSocket:()=>this.socket,getCamera:()=>this.socket?this.camera:null,getParams:()=>({height:R(this.settings,this.dialogOpen),bbox:!!this.settings.bbox,timestamp:!!this.settings.timestamp}),getInterval:()=>1e3/z(this.settings),onFrame:e=>{this.#a=e,this.#o=``,this.render()},onError:e=>{this.#o=e,this.render()}});getRestartKey(e){return e.webUrl||``}startCamera(){this.#r=!1,this.#a=``,this.#o=``,this.#i++,this.#e||this.#l()}stopCamera(){this.#n++,this.#t=$}syncDelivery(){let e=this.isRunning&&this.#d();e!==this.#s&&(this.#s=e,e?this.#c.start():this.#c.stop())}onDialogToggled(){this.#c.reschedule()}async#l(){let e=this.socket,t=this.camera;if(!e||!t)return;let n=t.instance,r=++this.#n;this.#t=$;let i=setTimeout(()=>{r===this.#n&&(console.warn(`[frigate] "frigate:getWebUrl" to ${n}: no answer within ${B} ms. Taking the pictures over the socket meanwhile.`),this.#t={...this.#t,resolved:!0},this.render())},B),a,o=``;try{a=await e.sendTo(n,`frigate:getWebUrl`,{hostname:window.location.hostname}),!a?.url&&!a?.reason&&(o=`answer without an address: ${JSON.stringify(a)}`)}catch(e){o=`request failed: ${String(e)}`}finally{clearTimeout(i)}r===this.#n&&(o&&console.warn(`[frigate] "frigate:getWebUrl" to ${n}: ${o}. Taking the pictures over the socket.`),this.#t={resolved:!0,url:a?.url||``,route:a?.route||``,reason:a?.url?``:a?.reason||``},this.#o=``,this.render())}#u(){let e=this.settings.webUrl||this.#t.url;return e?e.replace(/\/+$/,``)===window.location.origin?``:e:null}#d(){return this.#e||this.#r||this.#t.resolved&&!this.#t.reason&&this.#u()===null}#f(e){let t=this.#u();return!this.camera||t===null?null:re(t,this.#t.route,this.camera,`stream.mjpeg`,{fps:z(this.settings),height:R(this.settings,e),bbox:this.settings.bbox?1:void 0,timestamp:this.settings.timestamp?1:void 0})}#p(e,t){this.#r||!this.isRunning||(console.warn(`[frigate] The stream ${e}: ${t}. Taking the pictures over the socket.`),this.#r=!0,this.#o=``,this.render())}getView(e){if(this.#d())return this.#o?{kind:`hint`,text:this.#o,error:!0}:this.#a?{kind:`frame`,src:ne(this.#a)}:{kind:`loading`};if(!e&&this.dialogOpen)return{kind:`none`};let t=this.#f(e);return t===null?this.#t.reason?{kind:`hint`,text:this.word(ce[this.#t.reason]||`frigate_stream_needs_web`)}:{kind:`loading`}:{kind:`stream`,src:t,id:`${t}#${this.#i}`,onFail:e=>this.#p(t,e)}}});